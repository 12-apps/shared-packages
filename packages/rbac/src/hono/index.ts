import { Hono } from 'hono';
import type { Context } from 'hono';

import { createApiRbac, type ApiRbac } from '../server/create-api-rbac';
import type { RbacActor, RbacServerConfig } from '../server/context';

/**
 * `@12-apps/rbac/hono` — the RBAC admin endpoints as a mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is
 * the adapter for the framework we happen to use, behind its own subpath with
 * `hono` as an OPTIONAL peer (the report-builder precedent — a host on
 * Express, or one that only wants the React surface, never resolves Hono).
 *
 * A host writes:
 *
 *   const rbac = rbacRouter({ …config, resolveActor });
 *   app.route('/api/admin/:tenantSlug', rbac.router);
 *
 * and keeps what is genuinely its own: who the caller is, and which tenant
 * the slug resolves to. Everything after that — guards, governance, parsing,
 * status codes, the envelope — is the package's.
 */

/**
 * Resolve the caller. Returning `null` means unauthenticated, which answers
 * 401 before any handler runs. Billing gates (an entitlement check on the
 * roles surface, say) belong HERE too — answered before delegating.
 */
export type ResolveRbacActor = (
  c: Context,
) => Promise<RbacActor | null> | RbacActor | null;

export interface RbacHonoConfig<P extends string> extends RbacServerConfig<P> {
  resolveActor: ResolveRbacActor;
}

export interface RbacHono<P extends string> extends ApiRbac<P> {
  router: Hono;
}

/** Reads the JSON body, tolerating an absent or malformed one. */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === 'GET' || c.req.method === 'DELETE') return undefined;
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the caller's error; the handler's own validation
    // reports it far better than a parse failure would.
    return undefined;
  }
}

export function rbacRouter<P extends string>(config: RbacHonoConfig<P>): RbacHono<P> {
  const api = createApiRbac(config);
  const router = new Hono();

  // Mounted IN DESCRIPTOR ORDER — `/team/context` before `/team/:userId` is a
  // rule of the surface, not of the host (see routes-team.ts).
  for (const route of api.routes) {
    const handler = async (c: Context) => {
      const actor = await config.resolveActor(c);
      if (!actor) return c.json({ error: 'Não autenticado.' }, 401);

      const response = await route.handle({
        actor,
        params: c.req.param() as Record<string, string | undefined>,
        query: c.req.query() as Record<string, string | undefined>,
        body: await readBody(c),
      });

      // A handler that chose NO body means exactly that (204).
      if (response.body === undefined) return c.body(null, response.status as 204);
      // The status travels with the body the handler chose; the adapter never
      // reinterprets either.
      return c.json(response.body as Record<string, unknown>, response.status as 200);
    };

    if (route.method === 'GET') router.get(route.path, handler);
    else if (route.method === 'POST') router.post(route.path, handler);
    else if (route.method === 'PATCH') router.patch(route.path, handler);
    else if (route.method === 'PUT') router.put(route.path, handler);
    else router.delete(route.path, handler);
  }

  return { ...api, router };
}
