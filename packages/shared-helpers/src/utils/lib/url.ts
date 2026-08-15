/**
 * URL Utilities for Remix Applications
 *
 * This module provides utilities for working with URLs in Remix applications.
 *
 * @module shared-ui/url
 */

/**
 * Extracts the base server URL from a Remix Request object
 * @param request - Remix Request object
 * @param changeToHttpsIfNotLocalhost - If true, changes http to https for non-localhost URLs
 * @returns Base server URL (e.g., "https://example.com")
 * @example
 * getServerBaseUrl(request, true) // "https://example.com"
 * getServerBaseUrl(request, false) // "http://localhost:3000"
 */
export function getServerBaseUrl(request: Request, changeToHttpsIfNotLocalhost: boolean): string {
  // Get the requested URL
  const requestUrl = request.url;

  // Remove the page name
  const colonSlashSlashPosition = requestUrl.indexOf('://');
  const firstSlashPosition = requestUrl.indexOf('/', colonSlashSlashPosition + 3);
  let serverUrl = requestUrl.substring(0, firstSlashPosition);

  // Change the protocol to HTTPS if not localhost
  if (changeToHttpsIfNotLocalhost && !serverUrl.includes('localhost')) {
    serverUrl = serverUrl.replace('http://', 'https://');
  }

  return serverUrl;
}

/**
 * Extracts a cookie value from a Request.
 *
 * @deprecated Prefer `@12-apps/request-scope`, which owns cookies properly: a
 * paired read/write codec (`createCookieCodec`), the ambient `cookies()` /
 * `headers()` accessors, and `setResponseCookie`. This helper is READ-ONLY —
 * there is no serializer beside it, so whatever it reads was written by
 * something that does not share its rules.
 *
 * Fixed rather than deleted so existing callers stop losing data on their next
 * patch release; new code should not add call sites.
 *
 * One wart is preserved deliberately, because changing the return type would
 * break callers silently rather than loudly: an ABSENT cookie and one with an
 * EMPTY value both yield `''`. Telling those apart needs the codec.
 *
 * @param request - the incoming request
 * @param cookieName - name of the cookie to retrieve
 * @returns the decoded cookie value, or `''` when absent (or genuinely empty)
 * @example
 * const token = getCookieValue(request, 'auth_token');
 */
export function getCookieValue(request: Request, cookieName: string): string {
  const cookieString = request.headers.get('Cookie');

  if (!cookieString) {
    return '';
  }

  for (const cookie of cookieString.split(';')) {
    const trimmedCookie = cookie.trim();
    // Split on the FIRST `=` only. `split('=')` and taking element [1] drops
    // everything after the second one, silently truncating every value that
    // contains one — base64 padding and an encoded `%3D` among them, so a
    // session token comes back subtly wrong rather than missing.
    const separator = trimmedCookie.indexOf('=');

    if (separator > 0 && trimmedCookie.slice(0, separator) === cookieName) {
      return decodeCookieValue(trimmedCookie.slice(separator + 1));
    }
  }

  return '';
}

/**
 * `decodeURIComponent` that falls back to the raw text.
 *
 * Values are routinely percent-encoded on write — RFC 6265 forbids `;`, `,`,
 * whitespace and control characters in one — and this helper used to return
 * them still encoded, so a value round-tripped through any conforming
 * serializer came back as `caf%C3%A9` rather than `café`.
 *
 * The fallback is not defensive padding. A cookie header is attacker-supplied,
 * a lone `%` makes `decodeURIComponent` throw, and throwing here would turn a
 * junk cookie into a 500 on every request carrying it — for a visitor who
 * cannot see the cookie to clear it.
 */
function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
