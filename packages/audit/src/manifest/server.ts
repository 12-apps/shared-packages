/**
 * `@12-apps/audit/manifest/server` — the server capabilities.
 *
 * `http.create` wraps `createApiAudit` in a WIRE VIEW, because the two request
 * shapes differ in exactly two places and both are the adapter's business
 * rather than a host's:
 *
 * - **`header(name)` vs `request.headers`.** `AuditRequest` asks for a lookup
 *   function; the wiring contract carries the raw `Request`. The view closes
 *   over it, so a host stops hand-building a header accessor — the shape of
 *   bug that made the push-device hint a per-host field to forget.
 * - **`raw` carries the actor.** It is the field `AuditRequest` documents as
 *   existing for `resolveActor` alone, and the contract's `actor` is what a
 *   host resolved. Passing one as the other is the whole translation.
 *
 * The rest of the factory result rides beside the mapped routes on the
 * aggregate — `write`, `extendPrismaClient`, `extensions`, `withActorContext`,
 * `retention`, `store` and `vocabulary` are all things a host must still call
 * directly, and none of them is a route.
 */

import type { AnyServerManifest, WireRequest, WireResponse } from '@12-apps/wiring';

import {
  AUDIT_JOBS,
  createApiAudit,
  type ApiAudit,
  type AuditRoute,
  type AuditServerConfig,
} from '../server';

/** One `AuditRoute` as the wiring contract reads it. */
function asWireRoute(route: AuditRoute): {
  method: AuditRoute['method'];
  path: string;
  handle(request: WireRequest): Promise<WireResponse>;
} {
  return {
    method: route.method,
    path: route.path,
    handle: (request) =>
      route.handle({
        params: request.params,
        query: request.query,
        header: (name) => request.request?.headers.get(name) ?? undefined,
        raw: request.actor,
      }),
  };
}

/** `createApiAudit`, its routes re-shaped for the aggregate. */
export function createWireApiAudit(
  config: AuditServerConfig,
): Omit<ApiAudit, 'routes'> & { routes: ReturnType<typeof asWireRoute>[] } {
  const api = createApiAudit(config);
  return { ...api, routes: api.routes.map(asWireRoute) };
}

export const auditServerManifest = {
  name: '@12-apps/audit',
  http: { create: createWireApiAudit },
  /**
   * The retention sweep with its cadence. The host binds the `retention`
   * object it already builds from the same db seam, plus — if it has tier
   * windows at all — the resolver that yields them. See `../server/jobs` for
   * why the window is a dep and the schedule is not.
   */
  jobs: AUDIT_JOBS,
} as const satisfies AnyServerManifest;
