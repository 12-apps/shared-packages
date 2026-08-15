/**
 * The OAuth 2.1 authorization-server foundation: the shared scope source, the
 * issuer/audience derivation, and the trusted-origin resolver every URL in the
 * surface is built from (12-23, ported from the origin host's
 * `lib/mcp/oauth/config.ts`).
 *
 * Keeping the scopes and the origin resolution in ONE place is what stops the
 * two discovery documents — RFC 8414 `/.well-known/oauth-authorization-server`
 * and RFC 9728 `/.well-known/oauth-protected-resource` — from drifting apart,
 * and what makes a token minted for an origin verify against that same origin.
 *
 * What was env-reading in the host is CONFIG here (the package must not learn a
 * host's variable names); `trustedOriginsFromEnv` is the one-line helper that
 * keeps the origin host's wiring identical.
 */

/** Scopes advertised by both discovery documents. `mcp:write` gates mutating tools. */
export const MCP_SUPPORTED_SCOPES = ["mcp:read", "mcp:write"] as const;

export type McpScope = (typeof MCP_SUPPORTED_SCOPES)[number];

/** Path the MCP JSON-RPC endpoint is mounted at — the access token's audience. */
export const DEFAULT_MCP_RESOURCE_PATH = "/api/mcp";

/** The OAuth `iss` — the deployment origin, used verbatim. */
export function issuer(origin: string): string {
  return origin;
}

/** The access-token `aud` — the MCP resource URL (`${origin}${resourcePath}`). */
export function resourceAudience(
  origin: string,
  resourcePath: string = DEFAULT_MCP_RESOURCE_PATH,
): string {
  return `${origin}${resourcePath}`;
}

/**
 * A single bare `host` or `host:port` — no scheme, path, userinfo (`@`), or
 * whitespace. A syntactic guard so a forwarded host cannot smuggle anything but
 * a hostname; it does NOT by itself decide trust (the allowlist does).
 */
const HOST_ONLY =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i;

/** ASCII `/`. */
const SLASH = 0x2f;

/**
 * Strip trailing slashes by index, not by regex.
 *
 * `replace(/\/+$/, "")` is quadratic on a string of many slashes — the classic
 * anchored-quantifier backtrack — and this function is reached from an operator's
 * env var AND (through `resolveTrustedOrigin`) from values that arrive with a
 * request. A backwards walk is linear and needs no reasoning about the engine.
 */
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === SLASH) end -= 1;
  return value.slice(0, end);
}

/** Normalize an allowlist entry (trailing `/` stripped, blanks dropped). */
function normalizeOrigins(origins: readonly string[]): string[] {
  return origins.map((origin) => stripTrailingSlashes(origin.trim())).filter(Boolean);
}

/**
 * Read a comma-separated allowlist out of an environment variable — the origin host
 * passes `trustedOriginsFromEnv('MCP_OAUTH_TRUSTED_ORIGINS')`, so the behaviour
 * is identical while the variable's NAME stays the host's.
 */
export function trustedOriginsFromEnv(name: string): string[] {
  const raw = typeof process === "undefined" ? undefined : process.env?.[name];
  return raw ? normalizeOrigins(raw.split(",")) : [];
}

/**
 * The origin a request's forwarded headers CLAIM, or `null` when
 * absent/malformed. Only the first hop of a comma-separated list is taken, the
 * host must be a bare host[:port], and the proto is restricted to http/https.
 * This is a claim to be checked against the allowlist — never trusted alone.
 */
function claimedForwardedOrigin(getHeader: (name: string) => string | null): string | null {
  const host = getHeader("x-forwarded-host")?.split(",")[0]?.trim();
  if (!host || !HOST_ONLY.test(host)) return null;
  const proto = getHeader("x-forwarded-proto")?.split(",")[0]?.trim();
  return `${proto === "http" ? "http" : "https"}://${host}`;
}

/**
 * THE single trusted-origin resolver, shared by token ISSUANCE (the `iss`/`aud` a
 * token is minted with) and bearer VERIFICATION (the expected `aud` a protected
 * route checks). Because both sides pass the SAME request's headers, a token
 * minted for the allowlisted origin verifies against that same origin — they
 * cannot drift (e.g. mint `https://app.example.com` but verify
 * `http://0.0.0.0:3000` and reject a valid token).
 *
 * The origin must NEVER be attacker-controllable. Behind a reverse proxy the
 * server sees only its internal bind on `request.url`, so the public origin comes
 * from the proxy's `X-Forwarded-Host` — but a forwarded host is honored ONLY when
 * it is on the operator-configured allowlist; ANY other value (a spoofed/foreign
 * host, or an absent header) resolves to the canonical (FIRST) allowlisted origin.
 * So even if the edge forwards `X-Forwarded-Host: evil.example.com`, the origin
 * stays the trusted one.
 *
 * With NO allowlist configured a forwarded host is NEVER trusted — a spoofed
 * header must not be able to choose the issuer — so `fallbackOrigin` (the
 * request's OWN origin) is used instead. A proxied deployment therefore REQUIRES
 * the allowlist; until it is set the surface fails closed to the internal origin
 * rather than a foreign one.
 */
export function resolveTrustedOrigin(
  getHeader: (name: string) => string | null,
  fallbackOrigin: string | undefined,
  trustedOrigins: readonly string[] = [],
): string | undefined {
  const [canonical, ...rest] = normalizeOrigins(trustedOrigins);
  // No allowlist → the forwarded host is untrusted; fall back to the request's
  // own origin so a spoofed X-Forwarded-Host can never become the issuer.
  if (!canonical) return fallbackOrigin;

  const allowed = [canonical, ...rest];
  const claimed = claimedForwardedOrigin(getHeader);
  return claimed && allowed.includes(claimed) ? claimed : canonical;
}

/**
 * The PUBLIC origin every URL in the surface derives from (issuer, endpoint URLs,
 * access-token `iss`/`aud`). A thin wrapper over {@link resolveTrustedOrigin}
 * bound to a `Request`, falling back to the request URL's origin when no
 * allowlist is configured.
 */
export function originFromRequest(
  request: Request,
  trustedOrigins: readonly string[] = [],
): string {
  const fallback = new URL(request.url).origin;
  return (
    resolveTrustedOrigin((name) => request.headers.get(name), fallback, trustedOrigins) ?? fallback
  );
}
