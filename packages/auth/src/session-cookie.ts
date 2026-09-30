/**
 * The name Auth.js reads the session from — isomorphic, and deliberately so.
 *
 * It used to live beside the token MINTING (`./server/session-token`), which
 * pulls `@auth/core/jwt` in. That is the right home for encoding a token and
 * the wrong one for merely NAMING the cookie: a browser checking whether a
 * session exists, or a desktop agent watching a cookie jar for one, needs the
 * string and must not take a JWT library to get it.
 *
 * The derivation is Auth.js's own — the `__Secure-` prefix follows the resolved
 * base URL's protocol — and mirroring it rather than picking a name is what
 * keeps the cookie readable by the handler that has to read it back. Getting it
 * wrong fails SILENTLY in both directions: a cookie nothing looks for, or a
 * lookup that finds nothing and reports a live session as signed out.
 */

/** Whether this deployment is using `__Secure-`-prefixed cookies. */
function usesSecureCookies(baseUrl: string | undefined): boolean {
  return (baseUrl ?? "").startsWith("https://");
}

/**
 * The session cookie's name for a deployment served from `baseUrl`.
 *
 * `undefined` — a host that never resolved one — is treated as insecure, which
 * matches Auth.js's own default and is what a local dev origin needs.
 */
export function sessionCookieNameFor(baseUrl: string | undefined): string {
  return `${usesSecureCookies(baseUrl) ? "__Secure-" : ""}authjs.session-token`;
}
