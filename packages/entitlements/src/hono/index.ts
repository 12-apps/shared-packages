import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  createApiEntitlements,
  type ApiEntitlements,
  type ApiEntitlementsConfig,
  type EntitlementsActor,
} from '../server/create-api-entitlements';

/**
 * `@12-apps/entitlements/hono` — the entitlement endpoints as a mountable
 * router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is
 * the adapter for the framework we happen to use. It lives behind its own
 * subpath with `hono` as an OPTIONAL peer, so a host on Express — or one
 * that only wants the React surface — never resolves Hono at all.
 *
 * A host writes:
 *
 *   app.route('/api/admin/:tenantSlug', entitlementsRouter({ …, resolveActor }))
 *
 * and keeps what is genuinely its own: who the caller is, which tenant the
 * slug names, and whether that caller may file a plan-change request.
 */

/**
 * Resolve the caller. Returning `null` means unauthenticated, which answers
 * 401 before any handler runs.
 *
 * This is the one thing the package cannot supply: authentication, tenant
 * resolution and RBAC are the host's, and a package that guessed at them
 * would be wrong for every host but the first.
 */
export type ResolveEntitlementsActor = (
  c: Context,
) => Promise<EntitlementsActor | null> | EntitlementsActor | null;

export interface EntitlementsHonoConfig<F extends string> extends ApiEntitlementsConfig<F> {
  resolveActor: ResolveEntitlementsActor;
}

/** Reads the JSON body, tolerating an absent or malformed one. */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === 'GET') return undefined;
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the caller's error, and the handler's own
    // validation reports it far better than a parse failure would.
    return undefined;
  }
}

export function entitlementsRouter<F extends string>(
  config: EntitlementsHonoConfig<F>,
): { app: Hono; api: ApiEntitlements<F> } {
  const { resolveActor, ...apiConfig } = config;
  const api = createApiEntitlements(apiConfig);
  const app = new Hono();

  for (const route of api.routes) {
    const handler = async (c: Context) => {
      const actor = await resolveActor(c);
      if (!actor) return c.json({ error: 'Não autenticado.' }, 401);

      const response = await route.handle({ actor, body: await readBody(c) });

      // The status travels with the body the handler chose; this adapter never
      // reinterprets either, or the two halves of the contract would drift —
      // which is the whole reason the handlers live in the package.
      return c.json(response.body, response.status as 200);
    };

    if (route.method === 'GET') app.get(route.path, handler);
    else app.post(route.path, handler);
  }

  return { app, api };
}
