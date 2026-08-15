import { Hono } from "hono";
import type { Context } from "hono";

import { createApiPwa, type ApiPwa, type PwaServerConfig } from "../server/create-api-pwa";

/**
 * `@12-apps/pwa/hono` — the manifest endpoint (and, optionally, the packaged
 * worker) as a mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with `hono`
 * as an OPTIONAL peer — a host that only wants the install invite never resolves
 * it.
 *
 * Mounted at the ORIGIN ROOT, deliberately:
 *
 *   const pwa = pwaRouter({ resolveApp });
 *   app.route('/', pwa.router);
 *
 * Both assets have to be served from the root to do their job — a worker's
 * directory bounds its scope, and the manifest is linked from a static
 * `index.html` that cannot know a prefix.
 */
export interface PwaHono extends ApiPwa {
  router: Hono;
}

/**
 * The host this request claims. The forwarded header is read FIRST because a
 * reverse proxy is the normal topology for per-tenant domains — but it is a
 * CLAIM: whether to honour it is `resolveApp`'s decision, and the whole point of
 * the seam is that the host owns that call (the origin host resolves it against
 * verified-domain rows, so a spoofed header resolves to nothing).
 */
function hostOf(c: Context): string {
  const forwarded = c.req.header("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || c.req.header("host") || new URL(c.req.url).host;
  return host.toLowerCase();
}

/**
 * The forwarded host is an INPUT to the answer, so it belongs in the cache key.
 *
 * The manifest is cacheable and one path serves every tenant, so a cache that
 * keys on the URL alone will hand tenant A's name and icon to tenant B — and get
 * that INSTALLED on a home screen, which outlives the cache entry. A browser
 * proves it in one page: two `fetch`es of the same path with different forwarded
 * hosts, and the second is answered from the first without a request leaving.
 *
 * `Vary` is what makes the header part of the key wherever the response is stored
 * — the browser's own cache, and any shared proxy in front that does not already
 * include the host. It is added by the ADAPTER rather than by `createApiPwa`,
 * because reading that header is the adapter's decision: a host resolving its app
 * some other way should not advertise a variance it does not have.
 */
const VARY_ON_FORWARDED_HOST = "x-forwarded-host";

export function pwaRouter(config: PwaServerConfig): PwaHono {
  const api = createApiPwa(config);
  const router = new Hono();

  for (const route of api.routes) {
    router.get(route.path, async (c) => {
      const response = await route.handle({ request: c.req.raw, host: hostOf(c) });
      const headers = { ...response.headers, vary: VARY_ON_FORWARDED_HOST };
      // The status and body travel as the handler chose them; the adapter never
      // reinterprets either (a manifest is not an envelope). The two calls are one
      // overload each: Hono types `null` (an EMPTY body — what the 404 answers
      // with) separately from a string body.
      return response.body === null
        ? c.body(null, response.status as 404, headers)
        : c.body(response.body, response.status as 200, headers);
    });
  }

  return { ...api, router };
}
