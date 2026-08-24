/**
 * How an incoming request names the app it is asking for, and what a response
 * must therefore VARY on — the two decisions every adapter of this surface
 * has to make identically.
 *
 * They lived in `./hono` while that was the only adapter. The wiring
 * manifest's route view is a second one, and these are exactly the parts a
 * second copy gets subtly wrong: reading `host` before `x-forwarded-host`
 * behind a proxy resolves every tenant to the internal bind, and omitting
 * `Vary` lets ONE cacheable manifest URL serve every tenant — a shared cache
 * answers store B's visitor with store A's name and icon, and they INSTALL
 * it on a home screen, which outlives any cache entry.
 */

/**
 * The host this request claims. The forwarded header is read FIRST because a
 * reverse proxy is the normal topology for per-tenant domains — but it is a
 * CLAIM: whether to honour it is `resolveApp`'s decision, and the whole point
 * of the seam is that the host owns that call (the origin host resolves it
 * against verified-domain rows, so a spoofed header resolves to nothing).
 */
export function pwaRequestHost(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.headers.get("host") || new URL(request.url).host;
  return host.toLowerCase();
}

/**
 * The forwarded host is an INPUT to the answer, so it belongs in the cache key.
 *
 * The manifest is cacheable and one path serves every tenant, so a cache that
 * keys on the URL alone will hand tenant A's name and icon to tenant B — and
 * get that INSTALLED on a home screen, which outlives the cache entry. A
 * browser proves it in one page: two `fetch`es of the same path with different
 * forwarded hosts, and the second is answered from the first without a request
 * leaving.
 *
 * `Vary` is what makes the header part of the key wherever the response is
 * stored — the browser's own cache, and any shared proxy in front that does
 * not already include the host. It is added by an ADAPTER rather than by
 * `createApiPwa`, because reading that header is the adapter's decision: a
 * host resolving its app some other way should not advertise a variance it
 * does not have.
 */
export const PWA_VARY_ON_FORWARDED_HOST = "x-forwarded-host";
