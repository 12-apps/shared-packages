/**
 * `@12-apps/storage/manifest/server` — the server capabilities.
 *
 * `http.create` wraps `createApiStorage` in a WIRE VIEW that finally makes the
 * response rendering the PACKAGE's. `StorageRouteResponse` is a three-way
 * union — a JSON answer, an object's bytes, or a redirect to where the object
 * lives — and until now every host turned those three arms into a `Response`
 * itself. That is mechanism, identical for every host, and one arm of it is
 * a security detail rather than a formatting one:
 *
 *     const body = response.bytes.slice().buffer;
 *
 * The `.slice()` is load-bearing. A `Uint8Array` from Node is a view over a
 * POOLED allocation, so handing `.buffer` straight to `Response` serves the
 * client whatever else happens to share that pool. A host that re-derives this
 * renderer has to know that; a host that binds this manifest does not.
 *
 * The bytes and redirect arms therefore answer the contract's RAW half
 * (`{ response }`), which wiring 1.9.0 added for exactly this: answers
 * `{ status, body }` cannot express — a stream, a redirect whose headers are
 * the payload, bytes with their own content type.
 */

import type { AnyServerManifest, WireRequest, WireRouteAnswer } from '@12-apps/wiring';

import {
  createApiStorage,
  type ApiStorage,
  type ApiStorageConfig,
  type StorageRoute,
  type StorageRouteResponse,
} from '../server';

/** The descriptor's chosen answer, as the wiring contract carries it. */
export function asWireAnswer(response: StorageRouteResponse): WireRouteAnswer {
  if ('redirect' in response) {
    return { response: Response.redirect(response.redirect, 302) };
  }
  if ('bytes' in response) {
    // Its OWN ArrayBuffer — see the note above; a view over the pool leaks.
    const body = response.bytes.slice().buffer as ArrayBuffer;
    return {
      response: new Response(body, {
        status: response.status,
        headers: {
          ...response.headers,
          'content-length': String(response.bytes.byteLength),
        },
      }),
    };
  }
  return { status: response.status, body: response.body };
}

/** One `StorageRoute` as the wiring contract reads it. */
function asWireRoute(route: StorageRoute): {
  method: StorageRoute['method'];
  path: string;
  kind: 'authenticated' | 'public';
  wildcardParam?: string;
  handle(request: WireRequest): Promise<WireRouteAnswer>;
} {
  return {
    method: route.method,
    path: route.path,
    // Forwarded, and it has to be: the serve route's key is FOUR segments
    // (`products/<scope>/<uuid>/card-320.webp`), so an adapter that registers
    // only `path` answers the prefix and 404s every real object. `./hono`
    // spells the Hono form from this name; the contract carries the name so any
    // other adapter can spell its own. Dropping it here is what made this
    // package unmountable through a consumer at all — silently, because the
    // upload route worked and only reads 404'd.
    ...(route.wildcardParam === undefined ? {} : { wildcardParam: route.wildcardParam }),
    // The descriptor's own `auth` flag IS the contract's route kind: a
    // `public` object read is anonymous by design, and the host's gates read
    // this rather than a second table that could disagree with it.
    kind: route.auth === 'public' ? 'public' : 'authenticated',
    handle: async (request) => {
      if (!request.request) {
        throw new Error('@12-apps/storage needs the raw request — bind an adapter that forwards it.');
      }
      return asWireAnswer(
        await route.handle({
          actor: (request.actor ?? null) as Parameters<StorageRoute['handle']>[0]['actor'],
          params: request.params,
          request: request.request,
        }),
      );
    },
  };
}

/** `createApiStorage`, its routes re-shaped for the aggregate. */
export function createWireApiStorage(
  config: ApiStorageConfig,
): Omit<ApiStorage, 'routes'> & { routes: ReturnType<typeof asWireRoute>[] } {
  const api = createApiStorage(config);
  return { ...api, routes: api.routes.map(asWireRoute) };
}

export const storageServerManifest = {
  name: '@12-apps/storage',
  http: { create: createWireApiStorage },
} as const satisfies AnyServerManifest;
