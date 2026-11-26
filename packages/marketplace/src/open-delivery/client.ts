import {
  tokenGrantResultOf,
  type AdapterCallContext,
  type MarketplaceHttpRequest,
  type MarketplaceHttpResponse,
  type OutboundResult,
} from "../core/adapter";

/**
 * The HTTP half every Open Delivery adapter shares: the token grant and its
 * cache, and one authenticated call. Not a subpath: an adapter folder
 * (`../99food`, `../keeta`) builds a {@link OpenDeliveryDialect} and hands it
 * to these functions, so the standard is written once and each marketplace's
 * departures from it are data in its own folder.
 *
 * Open Delivery standardizes the PATHS under each Ordering Application's own
 * base URL, so the base URL per environment is part of the dialect.
 */

/** Where an Ordering Application serves Open Delivery, per environment. */
export type OpenDeliveryApiBaseUrls = Readonly<Record<"SANDBOX" | "PRODUCTION", string>>;

/** One marketplace's way of speaking Open Delivery: what differs from the standard, as data. */
export interface OpenDeliveryDialect {
  /** The provider id the adapter is registered under; it keys the token cache. */
  readonly provider: string;
  /** The marketplace's name, in the reasons a log reads ("99Food refused the token"). */
  readonly name: string;
  readonly bases: OpenDeliveryApiBaseUrls;
  /** The token grant's `Content-Type` and body: the standard's form-encoded `client_credentials`, or the marketplace's own. */
  tokenGrant(ctx: AdapterCallContext): { contentType: string; body: string };
  /** A JSON body exactly as it is sent (and, where a signature covers it, signed). */
  serialize(body: unknown): string;
  /** OPTIONAL. Headers derived from the final URL and body, added to EVERY call, the token grant included (a signature). */
  sign?(ctx: AdapterCallContext, url: string, body: string | undefined): Record<string, string>;
}

/** Refuse, at construction, a configured URL that is not https: credentials travel on it. */
export function assertHttpsUrl(packagePath: string, name: string, url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${packagePath}: ${name} is not a URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${packagePath}: ${name} must be https.`);
}

/** A token is renewed this long before it expires. */
const TOKEN_MARGIN_MS = 60_000;
/** `expires_in` is optional in the standard's `TokenResponse`; an hour when absent. ESTIMATED. */
const DEFAULT_TOKEN_SECONDS = 3600;

/** The result that ends a call before it was answered usefully. */
export type OpenDeliveryStop = Exclude<OutboundResult, { kind: "accepted" }>;

/** The base URL with its trailing slashes cut, by a loop: a `/\/+$/` regex backtracks polynomially on many slashes. */
export function baseOf(ctx: AdapterCallContext, bases: OpenDeliveryApiBaseUrls): string {
  const base = bases[ctx.environment];
  let end = base.length;
  while (end > 0 && base.charCodeAt(end - 1) === 47) end -= 1;
  return base.slice(0, end);
}

export const tokenKey = (ctx: AdapterCallContext, dialect: OpenDeliveryDialect): string =>
  `${dialect.provider}:${ctx.environment}:${ctx.credentials.clientId}`;

/** The standard's `TokenResponse` (`access_token`, `token_type`, `expires_in`), read defensively. */
function tokenOf(body: string): { token: string; expiresInSeconds: number } | null {
  try {
    const parsed = JSON.parse(body) as { access_token?: unknown; expires_in?: unknown };
    if (typeof parsed.access_token !== "string" || parsed.access_token === "") return null;
    const expires =
      typeof parsed.expires_in === "number" && parsed.expires_in > 0 ? parsed.expires_in : DEFAULT_TOKEN_SECONDS;
    return { token: parsed.access_token, expiresInSeconds: expires };
  } catch {
    return null;
  }
}

/** The dialect's signature headers for one request, or none. */
function signed(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  request: MarketplaceHttpRequest,
): MarketplaceHttpRequest {
  if (!dialect.sign) return request;
  return { ...request, headers: { ...request.headers, ...dialect.sign(ctx, request.url, request.body) } };
}

/**
 * A bearer token from the per-process cache, or a fresh grant at `POST
 * /oauth/token`. Keyed by provider, environment and client id; memory only.
 */
export async function bearer(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
): Promise<{ token: string } | OpenDeliveryStop> {
  const cached = ctx.tokens.get(tokenKey(ctx, dialect));
  if (cached && cached.expiresAt > ctx.now.getTime() + TOKEN_MARGIN_MS) return { token: cached.token };
  const grant = dialect.tokenGrant(ctx);
  const response = await ctx.http(
    signed(ctx, dialect, {
      method: "POST",
      url: `${baseOf(ctx, dialect.bases)}/oauth/token`,
      headers: { "Content-Type": grant.contentType },
      body: grant.body,
    }),
  );
  if (response.status < 200 || response.status >= 300) {
    const result = tokenGrantResultOf(response);
    return result.kind === "accepted" ? { kind: "retry", reason: "unexpected token answer" } : result;
  }
  const token = tokenOf(response.body);
  if (!token) return { kind: "retry", reason: `${dialect.name} answered the token grant without a token` };
  ctx.tokens.set(tokenKey(ctx, dialect), {
    token: token.token,
    expiresAt: ctx.now.getTime() + token.expiresInSeconds * 1000,
  });
  return { token: token.token };
}

/** One call, as an Open Delivery adapter states it. */
export interface OpenDeliveryCall {
  method: MarketplaceHttpRequest["method"];
  /** From the base: `/v1/orders/…`. Path segments are the caller's to encode. */
  path: string;
  /** Sent as the query string. */
  query?: Readonly<Record<string, string>>;
  /** A JSON body, serialized by the dialect. Absent: no body and no `Content-Type`. */
  body?: unknown;
  /** Extra headers (`X-App-MerchantId`). */
  headers?: Readonly<Record<string, string>>;
  /** Whether the call carries the bearer token. Default true; the standard's few open calls say false. */
  authenticated?: boolean;
}

/** The URL a call goes to: base, path, and the query string when there is one. */
export function urlOf(ctx: AdapterCallContext, dialect: OpenDeliveryDialect, call: OpenDeliveryCall): string {
  const query = call.query && Object.keys(call.query).length > 0 ? `?${new URLSearchParams(call.query).toString()}` : "";
  return `${baseOf(ctx, dialect.bases)}${call.path}${query}`;
}

/**
 * One call, authenticated unless it says otherwise: the raw answer, or the
 * result that ends it. A 401 is a token that went stale under us: it is
 * forgotten, and the retry fetches another.
 */
export async function openDeliveryCall(
  ctx: AdapterCallContext,
  dialect: OpenDeliveryDialect,
  call: OpenDeliveryCall,
): Promise<MarketplaceHttpResponse | OpenDeliveryStop> {
  const authenticated = call.authenticated ?? true;
  const auth = authenticated ? await bearer(ctx, dialect) : null;
  if (auth && !("token" in auth)) return auth;
  const body = call.body === undefined ? undefined : dialect.serialize(call.body);
  const response = await ctx.http(
    signed(ctx, dialect, {
      method: call.method,
      url: urlOf(ctx, dialect, call),
      headers: {
        ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...call.headers,
      },
      ...(body === undefined ? {} : { body }),
    }),
  );
  if (!authenticated || response.status !== 401) return response;
  ctx.tokens.delete(tokenKey(ctx, dialect));
  return { kind: "retry", reason: `${dialect.name} refused the token` };
}

/** Whether a call ended before an answer worth reading. */
export const isStop = (value: MarketplaceHttpResponse | OpenDeliveryStop): value is OpenDeliveryStop =>
  "kind" in value;
