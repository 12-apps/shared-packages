import { z } from 'zod';
import { CREDENTIALS_STRIPPED, describeFetchFailure, fetchJsonOutcome } from './fetch-reason';
import type { ConnectorContext, FetchFailure, FetchInit, SourceConfigCheck } from './types';
import { vtexAuthInit } from './vtex-auth';

/**
 * The VTEX save-time config probe (FUT-492): one cheap live call proving the
 * configured store really answers as a VTEX catalog API, run when a source is
 * created or edited. Production feedback that motivated it — "in the moment I
 * connect to some source here, it MUST validate if source is responding. to
 * prevent us to make useless requests": two misconfigured VTEX sources sat
 * silently DEGRADED for a day, each research fanning out to a dead store.
 *
 * Kept in its own module (not `vtex.ts`) because it shares nothing with the
 * search path but the endpoint shape, and the connector file is already at its
 * size budget.
 *
 * Probed endpoint: the LEGACY catalog search — the very request the default
 * search path makes, so a store that passes here is a store the pipeline can
 * really query. The `_from`/`_to` window asks for at most one product, which
 * is the cheapest answer that still proves the API (VTEX answers such a ranged
 * search with 200 or 206; both are a pass).
 *
 * The probe reads its answer through the SAME seam the search path does
 * (`./fetch-reason`, FUT-495) and phrases every fetch failure with the same
 * vocabulary, so "why can't I save this store" and "why did this source fail"
 * never contradict each other (FUT-498).
 */

const configSchema = z.object({ baseUrl: z.string().url() });

const INVALID_URL_ERROR =
  'URL da loja inválida ou não informada. Informe o endereço completo, ' +
  'como https://www.loja.com.br.';

/**
 * Refusing credentials in the store URL is a SAVE-TIME decision, not just
 * hygiene (FUT-498): `z.string().url()` accepts `https://chave:token@loja`,
 * that `baseUrl` is stored verbatim in the source's `config`, and connectors
 * concatenate it into diagnostics — which is exactly the leak
 * `lib/repositories/platform/research-scrub.ts` had to scrub back out of the
 * superadmin inbox (FUT-496). A public VTEX catalog needs no credentials, so
 * the userinfo section is refused at the dialog rather than carried around and
 * redacted downstream. The message names the shape, never the value.
 */
const CREDENTIALS_IN_URL_ERROR =
  'A URL da loja não pode conter usuário e senha (o trecho antes do "@"). ' +
  'Informe apenas o endereço público da loja, como https://www.loja.com.br.';

/** Why a configured `baseUrl` cannot be probed at all. */
type BaseUrlProblem = 'invalid' | 'credentials';

/**
 * The store address as a parsed URL, or the problem that stops the probe.
 * Everything downstream works on the URL object — no message and no request is
 * ever built by pasting the raw string together (finding 6).
 */
const parseBaseUrl = (config: Record<string, unknown>): URL | BaseUrlProblem => {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) return 'invalid';
  let url: URL;
  try {
    url = new URL(parsed.data.baseUrl);
  } catch {
    return 'invalid';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'invalid';
  return url.username === '' && url.password === '' ? url : 'credentials';
};

/** The legacy catalog search, and the window that asks for at most one product.
 *  `ft` is required by the endpoint; the term is deliberately trivial — the
 *  probe judges the ANSWER SHAPE, never the hits. */
const PROBE_PATH = '/api/catalog_system/pub/products/search';
const PROBE_QUERY = 'ft=a&_from=0&_to=0';

/**
 * The probe URL, REBUILT from the parsed address instead of concatenated onto
 * the raw one (FUT-498). A configured `baseUrl` may legally carry a query
 * string, a fragment or a userinfo section; pasting the endpoint after it
 * produced a corrupt request (`…?utm=x/api/catalog_system/…`) and could carry a
 * credential into a stored message. Rebuilding from `origin` + `pathname`
 * drops all three structurally — the same move the diagnostics scrubber makes
 * on the way out — while keeping a store hosted under a path working.
 */
const probeUrl = (base: URL): string => {
  const url = new URL(`${base.pathname.replace(/\/+$/, '')}${PROBE_PATH}`, base.origin);
  url.search = PROBE_QUERY;
  return url.toString();
};

/**
 * What a VTEX catalog search answers with: a bare product array (legacy) or
 * the intelligent-search `{ products: [...] }` envelope.
 */
const answerShapeSchema = z.union([
  z.array(z.unknown()),
  z.looseObject({ products: z.array(z.unknown()) }),
]);

/**
 * Keys a VTEX product/SKU carries and this connector actually reads — the
 * `items` → `sellers` → `commertialOffer` chain every offer is parsed out of,
 * plus the `productId` VTEX stamps on every payload.
 */
const VTEX_ITEM_KEYS = ['productId', 'items', 'sellers', 'commertialOffer'] as const;

const looksLikeVtexItem = (item: unknown): boolean =>
  typeof item === 'object' &&
  item !== null &&
  VTEX_ITEM_KEYS.some((key) => key in item);

/**
 * Is this answer a VTEX catalog's? The envelope alone is not enough (FUT-498):
 * accepting ANY JSON array let any list-answering API pass, and the owner then
 * got a source that saved cleanly and returned nothing forever. So a NON-EMPTY
 * answer must carry a VTEX-shaped first item — the probe asks for one product,
 * and a store that returns products returns them in that shape.
 *
 * An EMPTY answer is still a PASS, deliberately: a healthy store legitimately
 * answers `[]` to the trivial probe term (a small catalog, or a store that
 * regionalizes everything away), and refusing those would make real stores
 * unsaveable — a strictly worse failure than the one being fixed. The line is
 * therefore: shape-checked when there is something to check, trusted when the
 * store said "no hits" in VTEX's own envelope at VTEX's own endpoint.
 */
const looksLikeVtex = (payload: unknown): boolean => {
  const parsed = answerShapeSchema.safeParse(payload);
  if (!parsed.success) return false;
  const items = Array.isArray(parsed.data) ? parsed.data : parsed.data.products;
  return items.length === 0 || looksLikeVtexItem(items[0]);
};

/**
 * Second-level public suffixes, derived from a RULE rather than hand-listed
 * (FUT-498): a three-label host is still a bare registrable domain when its
 * last label is a two-letter ccTLD and the label before it is one of the
 * category labels registries put under one — `com.br`, `net.br`, `com.mx`,
 * `co.uk`, `co.jp`, `com.au`, `ind.br`… The repo ships no public-suffix list
 * and no dependency that carries one, so this is the honest widening of the
 * original five-entry set: it covers every ccTLD that uses these labels
 * instead of naming suffixes one country at a time. It stays conservative the
 * other way — `api.loja.br` and `www.loja.br` are NOT apexes, because `api`
 * and `www` are not registry labels.
 */
const REGISTRY_LABELS = new Set([
  // The generic set nearly every ccTLD mirrors.
  'com',
  'net',
  'org',
  'gov',
  'gob',
  'edu',
  'mil',
  'int',
  'co',
  'ac',
  'go',
  'ne',
  'or',
  // Brazil's category labels, where the stores this exists for live.
  'ind',
  'agr',
  'art',
  'esp',
  'adv',
  'srv',
  'tur',
  'nom',
  'emp',
  'eti',
  'far',
  'vet',
  'med',
  'eng',
  'psi',
  'rec',
  'blog',
  'flog',
]);

const CCTLD_RE = /^[a-z]{2}$/;

/** True for a bare registrable domain — `loja.com`, `loja.com.br`; no subdomain. */
const isApexHost = (hostname: string): boolean => {
  const labels = hostname.toLowerCase().split('.');
  if (labels.length === 2) return true;
  if (labels.length !== 3) return false;
  return REGISTRY_LABELS.has(labels[1] ?? '') && CCTLD_RE.test(labels[2] ?? '');
};

/**
 * The apex-vs-www nudge, appended to the failures where the ADDRESS is what
 * may be wrong. The guarded transport follows redirects (FUT-416), so an apex
 * that 301s to www probes fine — but an apex that answers nothing, or answers
 * as something else, is very often a store whose API only lives on `www`, and
 * that is the single most useful thing to try next. Only the hostname travels
 * into the text, so a URL's query string or userinfo never can.
 */
const apexHint = (base: URL): string =>
  isApexHost(base.hostname) ? ` Se a loja usa "www", tente https://www.${base.hostname}.` : '';

const HINT_RETRY = 'Tente novamente em alguns minutos.';

/** Nothing answered at all: DNS, TLS, a refused connection, a blocked hop. */
const unreachable = (failure: FetchFailure, base: URL): SourceConfigCheck => ({
  ok: false,
  error:
    'A loja não respondeu (fora do ar, bloqueando nosso acesso, ou endereço errado): ' +
    `${describeFetchFailure(failure)}. Confira a URL e tente novamente.${apexHint(base)}`,
});

/** The store was reached but ran out of time — an address worth retrying. */
const timedOut = (base: URL): SourceConfigCheck => ({
  ok: false,
  error: `A loja não respondeu dentro do tempo limite. ${HINT_RETRY}${apexHint(base)}`,
});

/**
 * The store ANSWERED, protectively or temporarily — a 429, a 408, a 5xx, a
 * 401/403 block. Its address resolves and its catalog API may well be right
 * there, so this must NOT read as "not a VTEX store" and must not blame the
 * URL (FUT-498 finding 2: a rate-limited store used to be reported as the
 * wrong kind of store, with no retry hint at all). The reason is
 * `describeFetchFailure`'s, so the dialog and the run screen say the same
 * thing about the same status.
 */
const notNow = (failure: FetchFailure): SourceConfigCheck => ({
  ok: false,
  error: `Não foi possível validar a loja agora: ${describeFetchFailure(failure)}. ${HINT_RETRY}`,
});

/** The address answered, but not as a VTEX catalog — the URL is the fix. */
const notVtex = (base: URL, status?: number): SourceConfigCheck => ({
  ok: false,
  error:
    `O endereço respondeu${status === undefined ? '' : ` (HTTP ${status})`}, mas não parece ser ` +
    `uma loja VTEX (resposta inesperada na API de catálogo). Confira a URL da loja.${apexHint(base)}`,
});

/**
 * The store refused the KEYED probe and accepted the IDENTICAL unkeyed one.
 * That is the one definitive key verdict available here, and it is definitive
 * precisely because the probed endpoint is a `pub` one that needs no
 * authentication: adding the key is the only thing that changed. Names the
 * fields and where they come from — never a value, never a fragment of one.
 */
const keyRejected = (): SourceConfigCheck => ({
  ok: false,
  error:
    'A loja recusou a chave de aplicação informada — a mesma consulta sem chave foi aceita. ' +
    'Confira a chave e o token gerados no admin da própria loja e as permissões do papel ' +
    'no License Manager.',
});

/**
 * The key would have been DROPPED on the way, so the request was refused rather
 * than sent anonymously: the guarded transport does not carry credential
 * headers across a host change, and a real store's chain is apex → www. The fix
 * is the address field, so the message points at it instead of reading as
 * "não parece ser uma loja VTEX".
 */
const credentialsStripped = (base: URL): SourceConfigCheck => ({
  ok: false,
  error:
    'A loja redireciona para outro endereço e a chave de aplicação não pode viajar junto. ' +
    `Configure aqui o endereço final da loja.${apexHint(base)}`,
});

/**
 * Statuses that mean "not right now", never "wrong address": the store
 * answered, so it is there — it protected itself (429 rate limit, 408/425
 * timing) or refused us (401/403 bot or IP block), and it may well be a VTEX
 * store. 5xx joins them for the same reason. Everything else non-2xx is the
 * catalog API not being at that address.
 */
const TRANSIENT_STATUSES = new Set([401, 403, 408, 425, 429]);

const isTransientStatus = (status: number): boolean =>
  status >= 500 || TRANSIENT_STATUSES.has(status);

/** Turn a fetch failure into the verdict the operator reads. */
const judgeFailure = (failure: FetchFailure, base: URL): SourceConfigCheck => {
  if (failure.kind === 'timeout') return timedOut(base);
  // OUR ceiling ran out, not the store's patience (FUT-516). Unreachable in
  // practice — this probe runs on the operator's SAVE request, which arms no
  // per-source deadline — but it must never fall through to the tail below,
  // which judges the ADDRESS: telling someone "this does not look like a VTEX
  // store" about a request we chose not to send would have them rewrite a URL
  // that was already right. `timedOut` is the honest neighbour: nothing came
  // back in the time available, and a retry is the action either way.
  if (failure.kind === 'deadline') return timedOut(base);
  if (failure.kind === 'transport') return unreachable(failure, base);
  // A 2xx that was not JSON is a storefront/challenge page, not a catalog API.
  if (failure.kind === 'body') return notVtex(base, failure.status);
  return isTransientStatus(failure.status) ? notNow(failure) : notVtex(base, failure.status);
};

/** The only statuses where the application key is itself a candidate culprit. */
const KEY_REJECTION_STATUSES = new Set([401, 403]);

/**
 * A KEYED probe failed — which of the two very different things happened
 * (FUT-520)? The probed endpoint needs no authentication, so the only test that
 * separates "the store rejected this key" from "the store's edge refuses us" is
 * the IDENTICAL request without the key: an unkeyed pass means the key is what
 * broke it, and that is definitive. An unkeyed failure means the block is not
 * about the key at all (measured: Atacadão refuses `/PUB/…` from our egress IP
 * with or without one) and the ordinary verdict stands, WORD FOR WORD — turning
 * that into "bad key" is the misattribution this ticket exists to avoid.
 *
 * The second call runs at save time only, on the failure path only, on the same
 * one-product window — never during a research.
 */
const judgeKeyedFailure = async (
  ctx: ConnectorContext,
  failure: FetchFailure,
  base: URL,
  url: string,
): Promise<SourceConfigCheck> => {
  if (failure.kind === 'transport' && failure.code === CREDENTIALS_STRIPPED) {
    return credentialsStripped(base);
  }
  if (failure.kind !== 'http' || !KEY_REJECTION_STATUSES.has(failure.status)) {
    return judgeFailure(failure, base);
  }
  const unkeyed = await fetchJsonOutcome(ctx, url);
  return unkeyed.ok && looksLikeVtex(unkeyed.payload) ? keyRejected() : judgeFailure(failure, base);
};

/**
 * The connector's `validateSourceConfig`. Never throws and never returns
 * `null`: a VTEX source always has something live to prove, so every arm is a
 * verdict the operator can act on — an unparseable `baseUrl`, one carrying
 * credentials, a store that said nothing, a store that is busy, a store that
 * answered something that is not a VTEX catalog. The GET goes through
 * `fetchJsonOutcome`, so a host that mounts the reason-carrying transport
 * (FUT-495) gets the precise arm and an older host degrades to the
 * undetermined transport failure instead of behaving differently.
 *
 * A configured application key (FUT-520) rides the SAME probe, so the save
 * exercises the path a run will take. A pass proves REACHABILITY only and never
 * that the key authenticates — this endpoint answers 200 with or without one —
 * so the caller must store the credential UNVERIFIED. Claiming VERIFIED on a
 * 200 here would be a lie the UI renders.
 */
export const validateVtexSourceConfig = async (
  config: Record<string, unknown>,
  ctx: ConnectorContext,
): Promise<SourceConfigCheck> => {
  const base = parseBaseUrl(config);
  if (base === 'invalid') return { ok: false, error: INVALID_URL_ERROR };
  if (base === 'credentials') return { ok: false, error: CREDENTIALS_IN_URL_ERROR };
  const url = probeUrl(base);
  const auth: FetchInit | undefined = vtexAuthInit({ config });
  const outcome = await fetchJsonOutcome(ctx, url, auth);
  if (!outcome.ok) {
    return auth === undefined
      ? judgeFailure(outcome.failure, base)
      : judgeKeyedFailure(ctx, outcome.failure, base, url);
  }
  return looksLikeVtex(outcome.payload) ? { ok: true } : notVtex(base);
};
