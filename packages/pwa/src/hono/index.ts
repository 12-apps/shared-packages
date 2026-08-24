import { Hono } from "hono";

import { createApiPwa, type ApiPwa, type PwaServerConfig } from "../server/create-api-pwa";
import { PWA_VARY_ON_FORWARDED_HOST, pwaRequestHost } from "../server/request";

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

export function pwaRouter(config: PwaServerConfig): PwaHono {
  const api = createApiPwa(config);
  const router = new Hono();

  for (const route of api.routes) {
    router.get(route.path, async (c) => {
      const response = await route.handle({ request: c.req.raw, host: pwaRequestHost(c.req.raw) });
      const headers = { ...response.headers, vary: PWA_VARY_ON_FORWARDED_HOST };
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
