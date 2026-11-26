/**
 * `@12-apps/tenant/hono` — mounts `createApiTenant`'s descriptors on a Hono app.
 *
 * Hono is an optional peer and is only TYPE-imported here: the adapter calls
 * `app.on(method, path, handler)` on whatever app the host passes.
 */
import type { Hono } from 'hono';

import type { GateRefusal, TenantGates } from '../lifecycle';
import type { ApiTenant } from '../server';

/** Mount every route of `tenant` on `app`, in order. Returns `app`. */
export function mountTenant<A extends Pick<Hono, 'on'>>(app: A, tenant: Pick<ApiTenant, 'routes'>): A {
  for (const route of tenant.routes) {
    app.on(route.method, route.path, (context) => route.handler(context.req.raw));
  }
  return app;
}

/**
 * A gate middleware, typed structurally (the request it reads and the `next`
 * it calls), so it fits any Hono version the host resolves the optional peer to.
 */
export type TenantGateMiddleware = (
  context: { req: { raw: Request } },
  next: () => Promise<void>,
) => Promise<Response | undefined>;

/** The one member of a Hono app the gate mount calls. */
export interface TenantGateApp {
  use(path: string, handler: TenantGateMiddleware): unknown;
}

/** A refusal as the response every gate renders: `{ error, code, details: {} }` with its status. */
function refused(refusal: GateRefusal): Response {
  return Response.json({ error: refusal.message, code: refusal.code, details: {} }, { status: refusal.status });
}

/** The admin gate as a middleware: mount it on `<admin.prefix>/*`. */
export function tenantAdminGate(gates: Pick<TenantGates, 'adminRefusal'>): TenantGateMiddleware {
  return async (context, next) => {
    const refusal = await gates.adminRefusal(context.req.raw);
    if (refusal !== null) return refused(refusal);
    await next();
    return undefined;
  };
}

/** The public gate as a middleware: mount it on each `<public.prefix>/<family>/*`. */
export function tenantPublicGate(gates: Pick<TenantGates, 'publicRefusal'>): TenantGateMiddleware {
  return async (context, next) => {
    const refusal = await gates.publicRefusal(context.req.raw);
    if (refusal !== null) return refused(refusal);
    await next();
    return undefined;
  };
}

/** Mount both gates: `<admin.prefix>/*`, then `<public.prefix>/<family>/*` for each family. Returns `app`. */
export function mountTenantGates<A extends TenantGateApp>(
  app: A,
  gates: Pick<TenantGates, 'adminRefusal' | 'publicRefusal' | 'config'>,
): A {
  app.use(`${gates.config.admin.prefix}/*`, tenantAdminGate(gates));
  const pub = tenantPublicGate(gates);
  for (const family of Object.keys(gates.config.public.families)) app.use(`${gates.config.public.prefix}/${family}/*`, pub);
  return app;
}
