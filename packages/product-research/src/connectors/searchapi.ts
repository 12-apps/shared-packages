import { credentialsOf } from '../integrations';
import type { SourceRecord } from '../types';
import { fetchJsonOutcome } from './fetch-reason';
import {
  boundVendorText,
  searchApiFailureMessage,
  searchApiKeyMissingMessage,
  searchApiPayloadShapeMessage,
  searchApiVendorErrorMessage,
} from './searchapi-errors';
import type { ConnectorContext, CredentialCheck } from './types';
import { diagnosticsOf } from './types';

/**
 * SearchApi.io transport, shared by every connector that rides the vendor.
 *
 * VENDOR DECISION (FUT-418): SearchApi.io over SerpApi. One account covers
 * both engines this epic needs — `google_shopping` (this SERP connector) and
 * `amazon_search` (FUT-419) — with the same request/response conventions, so
 * the second paid connector reuses this file instead of a second vendor
 * integration. SerpApi is the recorded FALLBACK: near-identical parameters
 * and result shapes, so a swap is this module plus the response field names,
 * never the connectors' extraction logic.
 *
 * The API key is TENANT-first (FUT-434): the integration's decrypted
 * credential in `source.config` — the key the tenant pasted, whose usage is
 * billed to them — wins, and the host env seam (`SEARCHAPI_API_KEY` via
 * env/Doppler in Paladira; named here and in the host, never in a message an
 * operator reads — FUT-517) is only the platform-level fallback. Either way it
 * travels in the Authorization header, never in the URL, so a logged request
 * line can't leak it. A missing key is an expected condition: the caller gets
 * an error result and the pipeline shows the source degraded — never a
 * throw, and never a silent skip.
 */

export const SEARCHAPI_BASE_URL = 'https://www.searchapi.io/api/v1/search';

/**
 * The vendor's account endpoint — answers 200 with account data for a valid
 * key and 401 `{"error":"Invalid API key."}` otherwise (verified live,
 * 2026-07). The save-time credential probe uses it because it authenticates
 * WITHOUT spending a paid search.
 */
export const SEARCHAPI_ACCOUNT_URL = 'https://www.searchapi.io/api/v1/me';

/**
 * The shared spend pool (`PriceSourceConnector.budgetScope`) for every
 * connector riding this vendor: SERP and AMAZON calls hit the same
 * SearchApi.io invoice, so they must drain the same budget counters.
 */
export const SEARCHAPI_BUDGET_SCOPE = 'SEARCHAPI';

/**
 * This vendor's per-call fetch budget (FUT-502) — the `ConnectorContext`
 * `timeoutMs` every SearchApi search runs under, instead of the host's 10s
 * default.
 *
 * FROM MEASUREMENT, not taste. Live production, tenant `future-drink`, query
 * "coca cola 220ml", two runs an hour apart on the SAME key:
 *   - `google_shopping` OK in 7967ms with 40 offers;
 *   - `google_shopping` aborted at 10346ms — reported as unreachable, one paid
 *     credit spent, zero offers — while `amazon_search` answered in 3106ms in
 *     that very run.
 * So the engine's normal latency sits right under the old 10s ceiling and its
 * tail crosses it: the source failed intermittently and every failure cost the
 * tenant a credit. 20s is ~2.5× the measured success and ~2× the highest
 * latency ever observed (the abort only proves the request was still alive at
 * 10.3s — its true duration is unknown, which is exactly why the headroom is a
 * multiple and not "10.3s plus a bit").
 *
 * Why not higher: research runs in a background job, so a slow answer costs no
 * request, but a source that hangs delays the whole fan-out (`Promise.all`) and
 * therefore the buyer's result. Why not per engine: `amazon_search` at 3.1s
 * needs no separate number — a budget is a CEILING, and a fast engine never
 * reaches it.
 */
export const SEARCHAPI_TIMEOUT_MS = 20_000;

/** Read per call, so a rotated key is picked up without a process restart. */
export type SearchApiKeySource = () => string | undefined;

/** The credential field the integration dialog saves (FUT-434). */
const API_KEY_FIELD = 'apiKey';

/**
 * The key one SearchApi call runs on: the TENANT credential the host injected
 * into `source.config` (FUT-434) wins — usage is billed to the tenant that
 * pasted it — and the host env seam is the platform fallback. Neither present
 * = undefined, which `callSearchApi` reports as the visible not-configured
 * failure without any HTTP call.
 */
export const resolveSearchApiKey = (
  source: Pick<SourceRecord, 'config'>,
  getApiKey: SearchApiKeySource,
): string | undefined => credentialsOf(source)[API_KEY_FIELD]?.trim() || getApiKey();

/**
 * Save-time credential probe shared by the SERP and AMAZON connectors: ONE
 * cheap call to the vendor's account endpoint proving the pasted key
 * authenticates — no search spent. Definitive rejection (401/403) is
 * `ok: false`; an unreachable vendor — or a host transport that cannot
 * report statuses — is `null` (unverifiable), so the save stays non-blocking
 * per the FUT-434 doctrine.
 */
export const validateSearchApiKey = async (
  credentials: Record<string, string>,
  ctx: ConnectorContext,
): Promise<CredentialCheck | null> => {
  const apiKey = credentials[API_KEY_FIELD]?.trim();
  if (!apiKey) return { ok: false, error: 'credencial sem o campo "apiKey"' };
  const init = { headers: { Authorization: `Bearer ${apiKey}` } };
  if (!ctx.fetchJsonStatus) {
    // OK-or-null transport: a 200 proves the key, but a null could be either
    // a rejection or an outage — never turn "unsure" into a refused save.
    const payload = await ctx.fetchJson(SEARCHAPI_ACCOUNT_URL, init);
    return payload === null ? null : { ok: true };
  }
  const response = await ctx.fetchJsonStatus(SEARCHAPI_ACCOUNT_URL, init);
  return response === null ? null : checkFromAccountAnswer(response);
};

/**
 * Classify the account endpoint's answer: 2xx proves the key; 401/403 is the
 * definitive rejection (with the vendor's reason when the body carries one);
 * anything else — 5xx and friends — proved nothing about the key: `null`.
 */
const checkFromAccountAnswer = (response: {
  status: number;
  payload: unknown | null;
}): CredentialCheck | null => {
  if (response.status >= 200 && response.status < 300) return { ok: true };
  if (response.status !== 401 && response.status !== 403) return null;
  const body = response.payload as { error?: unknown } | null;
  // The vendor's reason is third-party text on its way to the integrations
  // dialog, so it is bounded like every other echo (FUT-517); a body that
  // bounds down to nothing is no reason at all, and the status stands in.
  const vendorReason = typeof body?.error === 'string' ? boundVendorText(body.error) : '';
  const reason = vendorReason === '' ? `HTTP ${response.status}` : vendorReason;
  return { ok: false, error: `SearchApi rejeitou a chave: ${reason}` };
};

/** The vendor `q` param: the query term, brand-prefixed when it's missing. */
export const searchTermOf = (query: { term: string; brand?: string }): string => {
  const brandMissing =
    query.brand !== undefined && !query.term.toLowerCase().includes(query.brand.toLowerCase());
  return (brandMissing ? `${query.brand} ${query.term}` : query.term).trim();
};

export type SearchApiCallResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: string };

export interface SearchApiCallInput {
  engine: string;
  /** Query params besides `engine`; undefined/empty values are omitted. */
  params: Readonly<Record<string, string | undefined>>;
  apiKey: string | undefined;
}

export const buildSearchApiUrl = (
  engine: string,
  params: Readonly<Record<string, string | undefined>>,
): string => {
  const query = new URLSearchParams({ engine });
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(name, value);
  }
  return `${SEARCHAPI_BASE_URL}?${query.toString()}`;
};

/**
 * One paid vendor call, never-throw. Every failure mode — key not configured, a
 * rejected key, a timeout, a network failure, or a vendor-reported error body —
 * maps to an error result the pipeline records as a degraded source stat.
 *
 * The GET rides `fetchJsonOutcome` (FUT-495) on this vendor's own budget
 * (FUT-502), so the recorded reasons are now DISTINCT: a 10.3s abort reads as a
 * timeout naming its budget, and a 401 reads as a rejected key. On `fetchJson`
 * — where both were one `null` — they were the same sentence, and production
 * blamed a healthy key for a slow engine.
 */
export const callSearchApi = async (
  ctx: ConnectorContext,
  input: SearchApiCallInput,
): Promise<SearchApiCallResult> => {
  if (!input.apiKey) {
    return { ok: false, error: searchApiKeyMissingMessage(input.engine, diagnosticsOf(ctx).searchApi) };
  }
  const url = buildSearchApiUrl(input.engine, input.params);
  const outcome = await fetchJsonOutcome(ctx, url, {
    headers: { Authorization: `Bearer ${input.apiKey}` },
    timeoutMs: SEARCHAPI_TIMEOUT_MS,
  });
  if (!outcome.ok) {
    return {
      ok: false,
      error: searchApiFailureMessage(input.engine, outcome.failure, SEARCHAPI_TIMEOUT_MS, diagnosticsOf(ctx).searchApi),
    };
  }
  const payload = outcome.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, error: searchApiPayloadShapeMessage(input.engine, diagnosticsOf(ctx).searchApi) };
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === 'string') {
    return { ok: false, error: searchApiVendorErrorMessage(input.engine, record.error, diagnosticsOf(ctx).searchApi) };
  }
  return { ok: true, payload: record };
};
