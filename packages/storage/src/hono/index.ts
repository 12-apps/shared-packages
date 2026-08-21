import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  createApiStorage,
  type ApiStorage,
  type ApiStorageConfig,
} from '../server/create-api-storage';
import type { StorageActor, StorageRouteResponse } from '../server/routes';

/**
 * `@12-apps/storage/hono` — the upload surface as a mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with `hono`
 * as an OPTIONAL peer — a host on Express, or one that only wants the React half,
 * never resolves it.
 *
 * A host writes:
 *
 *   const storage = storageRouter({ …config, resolveActor });
 *   app.route('/api', storage.router);
 *
 * and keeps what is genuinely its own: who the caller is, and which tenant they
 * are acting for. The wildcard the serve route needs is spelled here (`:key{.+}`)
 * rather than in the descriptor, because the syntax is this framework's.
 */

/**
 * Resolve the caller. `null` is unauthenticated and answers 401 before any
 * handler runs — which is also where a host's own gates belong (a read-only
 * impersonation, a plan that does not include uploads): answered before
 * delegating, never inside the package.
 */
export type ResolveStorageActor = (
  c: Context,
) => Promise<StorageActor | null> | StorageActor | null;

export interface StorageHonoConfig extends ApiStorageConfig {
  resolveActor: ResolveStorageActor;
  /**
   * The 401 body's sentence when `resolveActor` answers null — REQUIRED, the
   * host's words (pt-BR hosts: `PT_BR_STORAGE_UNAUTHENTICATED` from
   * `../pt-BR`). The old default was the same silent leak every other surface
   * here just paid down.
   */
  unauthenticatedMessage: string;
}

export interface StorageHono extends ApiStorage {
  router: Hono;
}

/** A response the descriptors chose, rendered in this framework's terms. */
function send(c: Context, response: StorageRouteResponse): Response {
  if ('redirect' in response) return c.redirect(response.redirect, 302);
  if ('bytes' in response) {
    // The bytes as their own ArrayBuffer: a Uint8Array over a pooled buffer would
    // hand the client whatever else shares that allocation.
    const body = response.bytes.slice().buffer as ArrayBuffer;
    return c.body(body, response.status as 200, {
      ...response.headers,
      'content-length': String(response.bytes.byteLength),
    });
  }
  // The status travels with the body the handler chose; this adapter never
  // reinterprets either, or the two halves of the contract would drift — which is
  // the whole reason the handlers live in the package.
  return c.json(response.body as Record<string, unknown>, response.status as 200);
}

export function storageRouter(config: StorageHonoConfig): StorageHono {
  const { resolveActor, unauthenticatedMessage, ...apiConfig } = config;
  const api = createApiStorage(apiConfig);
  const unauthenticated = unauthenticatedMessage;
  const router = new Hono();

  for (const route of api.routes) {
    const handler = async (c: Context): Promise<Response> => {
      const actor = route.auth === 'public' ? null : await resolveActor(c);
      if (route.auth === 'actor' && !actor) {
        return c.json({ error: unauthenticated }, 401);
      }
      const response = await route.handle({
        actor,
        params: c.req.param() as Record<string, string | undefined>,
        request: c.req.raw,
      });
      return send(c, response);
    };

    // `:key{.+}` and not `*`: the whole remainder is one parameter, which is what
    // makes a nested key (`products/<scope>/<uuid>/card-320.webp`) arrive intact
    // instead of as a path Hono has already split.
    const path = route.wildcardParam ? `${route.path}/:${route.wildcardParam}{.+}` : route.path;
    if (route.method === 'GET') router.get(path, handler);
    else router.post(path, handler);
  }

  return { ...api, router };
}
