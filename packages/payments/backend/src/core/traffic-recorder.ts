/**
 * A recorder for the HTTP calls a provider adapter makes — the evidence half
 * of a homologação (FUT-3696).
 *
 * A reviewer asks for "the requests and responses your integration sends",
 * and the only honest answer is the calls the PRODUCTION code path made: a
 * generator that rebuilt payloads by hand would be evidence of the generator.
 * So the adapters' wire calls go through {@link recordedFetch}, which is plain
 * `fetch` unless the caller is inside a recording (`recordTraffic`) — then each call is
 * also written down, redacted AS it is recorded, so a secret is never held in
 * the log at all, not even briefly.
 *
 * The per-call context is an AsyncLocalStorage rather than a module-level
 * flag: two operators running at once, or a checkout charging while evidence
 * is recorded, must never see each other's calls. It is INSTALLED by the
 * server-only `./homologacao-evidence` subpath rather than imported here,
 * because this module sits under the root entry, which the frontend's stories
 * value-import and which may reach no Node builtin
 * (`scripts/root-entry-browser-safe-gate.mjs`). Until something installs it,
 * {@link recordedFetch} is exactly `fetch`.
 */

/** One call as it went over the wire, with every secret already removed. */
export interface RecordedHttpCall {
  /** When the request left, ISO-8601 UTC. */
  at: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  /** Absent when the request never got an answer (see `error`). */
  status?: number;
  statusText?: string;
  responseBody?: unknown;
  /** The network failure, when there was no response. */
  error?: string;
}

const REDACTED = '***REDACTED***';

/** The slice of AsyncLocalStorage the recorder needs — see the module doc. */
interface TrafficContext {
  getStore(): RecordedHttpCall[] | undefined;
  run<T>(store: RecordedHttpCall[], fn: () => T): T;
}

let context: TrafficContext | null = null;

/** Called once, by the server-only subpath that owns the AsyncLocalStorage. */
export function installTrafficContext(installed: TrafficContext): void {
  context = installed;
}

/** The installed context — null when no server-only code has loaded yet. */
export function trafficContext(): TrafficContext | null {
  return context;
}

/** `fetch`, recorded when a recording is active. Same contract as `fetch`. */
export async function recordedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const log = context?.getStore();
  if (!log) return fetch(url, init);
  const entry: RecordedHttpCall = {
    at: new Date().toISOString(),
    method: init.method ?? 'GET',
    url: redactUrl(url),
    requestHeaders: redactHeaders(init.headers),
    ...(typeof init.body === 'string' ? { requestBody: redactValue(parseBody(init.body)) } : {}),
  };
  try {
    const res = await fetch(url, init);
    const text = await res.clone().text().catch(() => '');
    entry.status = res.status;
    entry.statusText = res.statusText;
    if (text !== '') entry.responseBody = redactValue(parseBody(text));
    log.push(entry);
    return res;
  } catch (error) {
    entry.error = error instanceof Error ? error.message : String(error);
    log.push(entry);
    throw error;
  }
}

/**
 * Headers whose VALUE is a credential. `X_CLIENT_ID` is not on the list: the
 * client id is the application's public name, and the reviewer needs it.
 */
const SECRET_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x_client_secret',
  'x-client-secret',
  'x-authenticity-token',
]);

/** Body keys whose value is a credential or the card itself, wherever they sit. */
const SECRET_KEYS = new Set([
  'access_token',
  'refresh_token',
  'client_secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'accounttoken',
  'webhooktoken',
  'clientsecret',
  'password',
  'cvv',
  'security_code',
  'securitycode',
  'encrypted',
]);

/** Inside a `card` object these identify the instrument: PAN and vault id. */
const CARD_KEYS = new Set(['number', 'id']);

/** URL query parameters that carry a credential or a one-time code. */
const SECRET_PARAMS = ['code', 'access_token', 'refresh_token', 'token', 'client_secret'];

function redactHeaders(headers: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(headers).forEach((value, key) => {
    if (!SECRET_HEADERS.has(key)) {
      out[key] = value;
      return;
    }
    // Keep the scheme so the reader can see a bearer token WAS sent.
    out[key] = key === 'authorization' && /^bearer /i.test(value) ? `Bearer ${REDACTED}` : REDACTED;
  });
  return out;
}

/** The URL with every credential-bearing query parameter replaced. */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  for (const param of SECRET_PARAMS) {
    if (parsed.searchParams.has(param)) parsed.searchParams.set(param, REDACTED);
  }
  return parsed.toString();
}

/**
 * A deep copy with every secret value replaced. An OAuth `code` is redacted
 * only where it IS the authorization code (beside a `grant_type`): PagBank's
 * `payment_response.code` is the decline code, and hiding it would hide the
 * one thing a declined-card evidence exists to show.
 */
export function redactValue(value: unknown, insideCard = false): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, insideCard));
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const oauthBody = 'grant_type' in record;
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => {
      const lower = key.toLowerCase();
      if (SECRET_KEYS.has(lower) || (oauthBody && lower === 'code') || (insideCard && CARD_KEYS.has(lower))) {
        return [key, REDACTED];
      }
      return [key, redactValue(child, lower === 'card')];
    }),
  );
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
