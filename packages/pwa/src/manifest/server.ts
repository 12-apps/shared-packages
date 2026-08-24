/**
 * `@12-apps/pwa/manifest/server` — the server capabilities.
 *
 * `http.create` wraps `createApiPwa` in a WIRE VIEW, because a
 * `PwaRouteResponse` is `{ status, body, headers }` and the contract's JSON
 * half has no headers field — while HEADERS ARE THE PAYLOAD on both of these
 * routes:
 *
 * - `application/manifest+json` is what makes the browser's install
 *   machinery read the body at all;
 * - `service-worker-allowed: /` is what lets a worker served from anywhere
 *   claim the root scope;
 * - `cache-control` is the difference between a rebrand showing up the same
 *   day and a worker that can never be replaced;
 * - and `Vary` is the one that bites. One cacheable manifest URL serves
 *   every tenant, so without it a shared cache answers store B's visitor
 *   with store A's name and icon — and they INSTALL it on a home screen,
 *   which outlives any cache entry.
 *
 * So the view answers the contract's RAW half (`{ response }`, wiring
 * 1.9.0), and it is the ADAPTER for `Vary` and for the host derivation, the
 * two decisions `createApiPwa` deliberately leaves to whoever reads the
 * request. Both now come from `../server/request`, shared with `./hono`
 * rather than restated here: a second copy is exactly where reading `host`
 * before `x-forwarded-host` (every tenant resolving to the internal bind) or
 * a forgotten `Vary` would get in.
 *
 * THE MOUNT IS THE ORIGIN ROOT — `PWA_MOUNT_PATH` in `./index`, with the
 * reason written out there.
 *
 * Both routes are `public`. A browser fetches a web-app manifest with no
 * session and registers a worker before one exists; the gate that decides
 * who gets an answer is `resolveApp` returning `null`, which is a 404 with
 * an empty body — nothing to say and nothing to leak.
 */

import type { AnyServerManifest, WireRequest, WireRouteAnswer } from "@12-apps/wiring";

import {
  createApiPwa,
  type ApiPwa,
  type PwaRoute,
  type PwaRouteResponse,
  type PwaServerConfig,
} from "../server/create-api-pwa";
import { PWA_VARY_ON_FORWARDED_HOST, pwaRequestHost } from "../server/request";

/** The descriptor's chosen answer, as the wiring contract carries it. */
export function asWireAnswer(response: PwaRouteResponse): WireRouteAnswer {
  return {
    response: new Response(response.body, {
      status: response.status,
      // The forwarded host is an INPUT to the answer, so it belongs in the
      // cache key — see `../server/request`.
      headers: { ...response.headers, vary: PWA_VARY_ON_FORWARDED_HOST },
    }),
  };
}

/** One `PwaRoute` as the wiring contract reads it. */
function asWireRoute(route: PwaRoute): {
  method: PwaRoute["method"];
  path: string;
  kind: "public";
  handle(request: WireRequest): Promise<WireRouteAnswer>;
} {
  return {
    method: route.method,
    path: route.path,
    kind: "public",
    handle: async (request) => {
      if (!request.request) {
        throw new Error(
          "@12-apps/pwa needs the raw request — the app is resolved from its host header.",
        );
      }
      return asWireAnswer(
        await route.handle({
          request: request.request,
          host: pwaRequestHost(request.request),
        }),
      );
    },
  };
}

/** `createApiPwa`, its routes re-shaped for the aggregate. */
export function createWireApiPwa(
  config: PwaServerConfig,
): Omit<ApiPwa, "routes"> & { routes: ReturnType<typeof asWireRoute>[] } {
  const api = createApiPwa(config);
  return { ...api, routes: api.routes.map(asWireRoute) };
}

export const pwaServerManifest = {
  name: "@12-apps/pwa",
  http: { create: createWireApiPwa },
} as const satisfies AnyServerManifest;
