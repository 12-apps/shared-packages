import type { FetchFailure } from './types';

/**
 * The SearchApi connectors' failure copy (FUT-502, completed by FUT-517) — the
 * `vtex-errors.ts` analogue for the paid vendor every SERP/AMAZON search rides.
 *
 * WHY ITS OWN WORDING instead of `describeFetchFailure`: that describer speaks
 * about A STORE, and its clauses are actively wrong for an authenticated API.
 * It renders 401/403 as "a loja recusou nosso acesso (bloqueio de bot ou de
 * IP)" — for SearchApi a 401 means one thing only, the key was rejected, which
 * is the single most actionable message this path can produce. The FetchFailure
 * union it classifies (FUT-495) is the same one, read through `fetchJsonOutcome`;
 * only the sentences differ.
 *
 * A production run recorded "SearchApi google_shopping search unreachable or
 * rejected" for what was a 10.3s abort on a healthy key — one string for two
 * opposite operator actions (raise the budget vs. paste a new key). Every arm
 * is now distinct, and the timeout arm NAMES its budget so the next tuning
 * decision is made from the message instead of from the source.
 *
 * EVERY arm of a SearchApi call composes its sentence here, not only the ones
 * that come from a `FetchFailure` (FUT-517). Three were still built inline in
 * `searchapi.ts` and still in English — and the missing-key one named the host
 * env var `SEARCHAPI_API_KEY`, a platform-operator fact rendered to a tenant
 * admin who has no shell to set it in.
 *
 * NEVER interpolate the URL, its query string or the Authorization header here:
 * the vendor key travels in the query on some routes and this text is stored
 * and rendered (FUT-496). The engine name and an HTTP status are the whole
 * diagnostic.
 *
 * The one exception is the vendor's own `error` body, which IS the diagnostic
 * ("Searches quota exceeded for your plan" says what no sentence of ours could).
 * It is kept — but only ever through `boundVendorText`, single-lined and capped,
 * because unlike a status it is unbounded third-party text.
 */

/** The budget in whole seconds — how an operator thinks about a timeout. */
const budgetSeconds = (timeoutMs: number): string => `${Math.round(timeoutMs / 1000)}s`;

/** What a vendor HTTP status means for a paid search, in the operator's terms. */
const httpReason = (status: number): string => {
  if (status === 401 || status === 403) {
    return `chave recusada pelo provedor (HTTP ${status}) — verifique a chave da integração`;
  }
  if (status === 429) return 'limite de consultas do provedor atingido (HTTP 429)';
  if (status === 404) return 'endpoint do provedor não encontrado (HTTP 404)';
  if (status >= 500) return `provedor com erro interno (HTTP ${status}) — instabilidade momentânea`;
  return `provedor recusou a consulta (HTTP ${status})`;
};

const failureReason = (failure: FetchFailure, timeoutMs: number): string => {
  if (failure.kind === 'http') return httpReason(failure.status);
  if (failure.kind === 'body') {
    return `resposta HTTP ${failure.status} não era JSON — provável página de erro do provedor`;
  }
  if (failure.kind === 'timeout') {
    // The credit note is deliberate: the vendor bills successful searches, and
    // a search it completed AFTER we hung up is successful on its side — so a
    // timeout can cost a credit that bought nothing. Saying so is what makes
    // the `costUnits 1` on this stat make sense to whoever reads the run.
    return (
      `sem resposta no tempo limite de ${budgetSeconds(timeoutMs)} ` +
      '(o crédito pago pode ter sido consumido)'
    );
  }
  if (failure.kind === 'deadline') {
    // The mirror image of the timeout arm above, and the credit note flips with
    // it: no request left this process, so the vendor did no work and nothing
    // was billed. Without its own arm this fell through to the transport clause
    // below and read as "falha de conexão com o provedor (rede, DNS ou TLS)" —
    // a network diagnosis for a search we ourselves declined to send.
    return (
      'a busca nesta fonte atingiu o tempo total permitido antes desta consulta ' +
      '(nenhum crédito pago foi consumido)'
    );
  }
  return failure.code === undefined
    ? 'falha de conexão com o provedor (rede, DNS ou TLS)'
    : `falha de conexão com o provedor (rede, DNS ou TLS: ${failure.code})`;
};

/**
 * One vendor call's failure as a full sentence: which engine, and why. The
 * engine is part of the identity an operator needs — `google_shopping` failing
 * while `amazon_search` succeeds on the SAME key (exactly what production
 * showed) is the difference between a slow engine and a dead account.
 */
export const searchApiFailureMessage = (
  engine: string,
  failure: FetchFailure,
  timeoutMs: number,
): string => `SearchApi ${engine}: ${failureReason(failure, timeoutMs)}`;

/**
 * How much of the vendor's own wording is echoed. Every real body observed on
 * this route is an order of magnitude shorter — 'Searches quota exceeded for
 * your plan' is 37 characters — so the cap only ever fires on something that
 * is not a sentence.
 */
const VENDOR_TEXT_MAX = 200;

/**
 * The vendor's text made safe to compose into a message we STORE and RENDER:
 * one line, bounded, with the cut made visible.
 *
 * Whitespace collapses BEFORE the cap, not after. The case this exists for is
 * an HTML error page the vendor served under a JSON content type — hundreds of
 * newlines and indentation that would otherwise blow up a chip tooltip and the
 * superadmin diagnostics inbox — so the cap has to measure the text an operator
 * would actually read, not the markup's whitespace. Same ordering argument
 * `research-scrub.ts` makes for its own ceiling.
 */
export const boundVendorText = (raw: string): string => {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= VENDOR_TEXT_MAX) return collapsed;
  return `${collapsed.slice(0, VENDOR_TEXT_MAX)}…`;
};

/**
 * No key at all — the one failure that never reaches the vendor.
 *
 * Deliberately does NOT name the host env var (FUT-517). Its reader is the
 * tenant admin on the run screen, who cannot set one; and `resolveSearchApiKey`
 * collapses "no tenant credential" and "no platform key" into a single
 * `undefined`, so naming the var was already a guess about which half was
 * missing. The env fallback is unchanged and stays named where a platform
 * operator looks for it (`apps/web/lib/research/host.ts`, `turbo.json`). No
 * admin route is named either: this package is host-agnostic and does not know
 * the URL the tenant would click.
 */
export const searchApiKeyMissingMessage = (engine: string): string =>
  `SearchApi ${engine}: chave de API não configurada — conecte a integração ` +
  'de busca de preços com a chave da sua conta SearchApi.io';

/** A 2xx that is not a JSON object: there is no result list to read at all. */
export const searchApiPayloadShapeMessage = (engine: string): string =>
  `SearchApi ${engine}: o provedor respondeu em um formato inesperado — ` +
  'nenhuma oferta pôde ser lida';

/**
 * The vendor answered, and said no: a quota, a rejected parameter, an engine it
 * does not serve. Its own wording is the actionable half, so it is QUOTED
 * rather than paraphrased — the quotes mark it as the provider's sentence and
 * not ours, which is what makes an English tail inside a pt-BR line readable.
 * A vendor that refuses without a reason gets its own arm instead of an empty
 * pair of quotes.
 */
export const searchApiVendorErrorMessage = (engine: string, vendorError: string): string => {
  const detail = boundVendorText(vendorError);
  if (detail === '') {
    return `SearchApi ${engine}: o provedor recusou a consulta sem informar o motivo`;
  }
  return `SearchApi ${engine}: o provedor recusou a consulta — resposta do provedor: "${detail}"`;
};
