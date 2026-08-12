import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  createApiEntityLifecycle,
  type ApiEntityLifecycle,
  type EntityLifecycleServerConfig,
} from '../server/create-api-entity-lifecycle';
import { messagesOf, type LifecycleActor } from '../server/context';

/**
 * `@12-apps/entity-lifecycle/hono` — the lifecycle endpoints as a mountable
 * router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is
 * the adapter for the framework we happen to use, behind its own subpath with
 * `hono` as an OPTIONAL peer (the report-builder precedent — a host on
 * Express, or one that only wants the React surface, never resolves Hono).
 *
 * A host writes:
 *
 *   const lifecycle = entityLifecycleRouter({ …config, resolveActor });
 *   app.route('/api/admin/:tenantSlug', lifecycle.router);
 *
 * and keeps what is genuinely its own: who the caller is, which tenant the
 * slug resolves to, the tenant's feature layers and the caller's permission
 * ids. Everything after that — feature gates, approvals interception,
 * parsing, status codes, the envelope — is the package's.
 */

/**
 * Resolve the caller. Returning `null` means unauthenticated, which answers
 * 401 before any handler runs. Billing gates (future-pay's per-collection
 * plan entitlement) belong HERE too — answered before delegating.
 */
export type ResolveLifecycleActor = (
  c: Context,
) => Promise<LifecycleActor | null> | LifecycleActor | null;

export interface EntityLifecycleHonoConfig extends EntityLifecycleServerConfig {
  resolveActor: ResolveLifecycleActor;
}

export interface EntityLifecycleHono extends ApiEntityLifecycle {
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

export function entityLifecycleRouter(config: EntityLifecycleHonoConfig): EntityLifecycleHono {
  const api = createApiEntityLifecycle(config);
  const messages = messagesOf(config);
  const router = new Hono();

  // Mounted IN DESCRIPTOR ORDER — the literal `/drafts` routes precede the
  // `/:id` ones, a rule of the surface, not of the host (see routes-entity.ts).
  for (const route of api.routes) {
    const handler = async (c: Context) => {
      const actor = await config.resolveActor(c);
      if (!actor) return c.json({ error: messages.unauthenticated }, 401);

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
    else if (route.method === 'PUT') router.put(route.path, handler);
    else router.delete(route.path, handler);
  }

  return { ...api, router };
}
