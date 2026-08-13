import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';

import { createApiAudit, type ApiAudit } from '../server/create-api-audit';
import type { AuditRequest, AuditServerConfig } from '../server/config';

/**
 * `@12-apps/audit/hono` — the audit endpoints as a mountable router, plus the
 * actor-context middleware as Hono middleware.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with `hono`
 * as an OPTIONAL peer (the report-builder precedent — a host on Express, or one
 * that only wants the React viewer, never resolves Hono; nothing under `.` or
 * `./server` imports it).
 *
 * A host writes:
 *
 *   const audit = auditRouter({ …config });
 *   app.use('*', audit.actorContext);                 // stamp every request
 *   app.route('/api/admin/:tenantSlug', audit.router);
 *
 * and keeps what is genuinely its own: who the caller is, and which tenant the
 * slug resolves to.
 *
 * ## The envelope
 *
 * A success is `{ data }` — except the LIST, which is `{ data, pagination }`
 * unwrapped, because a page's totals are part of the page. A denial is
 * `{ error }` at the top level with the status the handler chose (401 / 403 /
 * 400), never wrapped in `data`: an interceptor that unwraps `data` blindly would
 * otherwise turn an error body into a value.
 */
/**
 * The adapter takes exactly the server config — `resolveActor` included, since it
 * is what the actor-context middleware stamps from — so there is no second thing
 * to wire. Aliased rather than re-declared so a host reads one name.
 */
export type AuditHonoConfig = AuditServerConfig;

export interface AuditHono extends ApiAudit {
  router: Hono;
  /**
   * Hono middleware that opens the actor-context scope for the request and stamps
   * the resolved actor into it. Mount it around EVERY route whose writes should
   * be attributed — not only this package's — because the context is what the
   * `created_by`/`updated_by` extension and the writer both read.
   */
  actorContext: MiddlewareHandler;
}

/** The normalized request a descriptor sees, built from a Hono context. */
function toAuditRequest(c: Context): AuditRequest {
  return {
    params: c.req.param() as Record<string, string | undefined>,
    query: c.req.query() as Record<string, string | undefined>,
    header: (name: string) => c.req.header(name),
    // The escape hatch `resolveActor` needs: reading a session cookie is host
    // work, and no handler in the package touches it.
    raw: c,
  };
}

export function auditRouter(config: AuditHonoConfig): AuditHono {
  const api = createApiAudit(config);
  const router = new Hono();

  // Mounted IN DESCRIPTOR ORDER — `/audit-logs/actors` before `/audit-logs` is a
  // rule of the surface, not of the host (see routes.ts).
  for (const route of api.routes) {
    router.get(route.path, async (c: Context) => {
      const response = await route.handle(toAuditRequest(c));
      if (response.body === undefined) return c.body(null, response.status as 204);
      // The status travels with the body the handler chose; the adapter never
      // reinterprets either.
      return c.json(response.body as Record<string, unknown>, response.status as 200);
    });
  }

  const actorContext: MiddlewareHandler = (c, next) =>
    api.withActorContext(toAuditRequest(c), () => next());

  return { ...api, router, actorContext };
}
