/**
 * `@12-apps/tenant/hono` — mounts `createApiTenant`'s descriptors on a Hono app.
 *
 * Hono is an optional peer and is only TYPE-imported here: the adapter calls
 * `app.on(method, path, handler)` on whatever app the host passes.
 */
import type { Hono } from 'hono';

import type { ApiTenant } from '../server';

/** Mount every route of `tenant` on `app`, in order. Returns `app`. */
export function mountTenant<A extends Pick<Hono, 'on'>>(app: A, tenant: Pick<ApiTenant, 'routes'>): A {
  for (const route of tenant.routes) {
    app.on(route.method, route.path, (context) => route.handler(context.req.raw));
  }
  return app;
}
