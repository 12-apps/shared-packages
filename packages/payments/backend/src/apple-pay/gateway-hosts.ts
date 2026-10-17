/**
 * The ONLY hosts a merchant validation may be sent to (FUT-3686).
 *
 * The `validationURL` arrives from the browser — Safari hands it to the page in
 * `onvalidatemerchant`, and the page posts it to us. Sent on unchecked, it is a
 * server-side request forgery that also PRESENTS THE MERCHANT IDENTITY
 * CERTIFICATE to whatever host the caller named. So the host is matched
 * EXACTLY against Apple's published list, never by suffix or substring
 * (`apple-pay-gateway.apple.com.evil.com` must fail).
 *
 * Source — Apple, "Setting up your server" (Apple Pay on the web), Listings 1
 * and 2, which tell a server to "allow only the Apple IP addresses and domains"
 * listed there:
 * https://developer.apple.com/documentation/applepayontheweb/setting-up-your-server
 * Read 2026-10-17. Apple has published per-pod hosts in the past and no longer
 * lists them; when the list changes, this set changes with it.
 */
export const APPLE_PAY_GATEWAY_HOSTS: ReadonlySet<string> = new Set([
  // Listing 1 — production.
  'apple-pay-gateway.apple.com',
  'cn-apple-pay-gateway.apple.com',
  // Listing 2 — sandbox testing.
  'apple-pay-gateway-cert.apple.com',
  'cn-apple-pay-gateway-cert.apple.com',
]);

/** Longer than any URL Apple hands out, short enough that nobody parses a megabyte for us. */
const MAX_URL_LENGTH = 2048;

/**
 * The validation URL, parsed and NORMALIZED, when it is one Apple could have
 * issued — otherwise `null`.
 *
 * Refused: anything that is not a string or does not parse; any scheme but
 * `https`; userinfo (`https://apple-pay-gateway.apple.com@evil.com` has
 * `evil.com` as its host, and even `user@apple-pay-gateway.apple.com` is not
 * what Apple sends); an explicit port other than the default (a port is not on
 * Apple's list, and the URL parser already folds `:443` away); and every host
 * not in {@link APPLE_PAY_GATEWAY_HOSTS}, compared after the WHATWG parser has
 * lower-cased it — so a trailing dot, a suffix or an IP literal all miss.
 *
 * Callers must send the returned URL's `href`, never the raw string, so the
 * thing that was checked is the thing that is dialled.
 */
export function applePayValidationUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.port !== '') return null;
  return APPLE_PAY_GATEWAY_HOSTS.has(url.hostname) ? url : null;
}
