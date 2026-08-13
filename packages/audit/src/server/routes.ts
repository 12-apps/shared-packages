/**
 * The audit surface's route DESCRIPTORS (12-14) — the package half of
 * future-pay's `app/api/admin/[tenantSlug]/audit-logs/route.ts`.
 *
 * Framework-neutral: a descriptor takes a normalized request and answers a
 * status + body, so `./hono` is an adapter rather than the contract. Both routes
 * are GETs; the trail has no write endpoint by design — entries are written
 * transactionally by the mutations themselves, so this is the only audit surface
 * and it is read-only.
 *
 * ROUTE ORDER IS PART OF THE SURFACE: `/audit-logs/actors` is registered BEFORE
 * `/audit-logs`, so a framework that matches greedily can never route the literal
 * segment into the listing. Adapters mount the array verbatim.
 */
import {
  AuditApiError,
  foldApiError,
  gatesOf,
  messagesOf,
  ok,
  pageResponse,
  requirePermission,
  type AuditActor,
  type AuditRequest,
  type AuditResponse,
  type AuditRoute,
  type AuditServerConfig,
} from './config';
import type { AuditStore } from './store';
import { parseAuditLogQuery } from './wire';
import type { AuditVocabularyIndex } from '../core/vocabulary';

interface RouteDeps {
  config: AuditServerConfig;
  index: AuditVocabularyIndex;
  store: AuditStore;
}

/**
 * Authenticate + authorize, once, for both routes.
 *
 * Returns the actor the HOST resolved. Note what is not here: any reading of
 * `request.params.tenantSlug`. The slug is the host's to resolve — it resolved it
 * inside `resolveActor`, together with the membership check that makes the
 * resulting `tenantId` the caller's own — so the descriptors never see a tenant
 * identifier that came off the wire.
 */
async function authorize(deps: RouteDeps, request: AuditRequest): Promise<AuditActor> {
  const messages = messagesOf(deps.config);
  const actor = await deps.config.resolveActor(request);
  if (!actor) throw new AuditApiError(401, messages.unauthenticated);
  requirePermission(actor, gatesOf(deps.config).read, messages);
  return actor;
}

function listRoute(deps: RouteDeps): AuditRoute {
  return {
    method: 'GET',
    path: '/audit-logs',
    async handle(request: AuditRequest): Promise<AuditResponse> {
      try {
        const actor = await authorize(deps, request);
        const query = parseAuditLogQuery(deps.index, request.query, messagesOf(deps.config));
        const page = await deps.store.listPage(actor.tenantId, query);
        return pageResponse(page.data, page.pagination);
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

/**
 * The "who" filter's options. Its own route rather than a facet of the listing:
 * the options are stable across every page and filter combination, so folding
 * them into the list would re-resolve a roster on every keystroke.
 *
 * Answers `{ data: [] }` — not 501 — when the host wired no directory: an empty
 * option list is exactly what the viewer needs to fall back to a free-text actor
 * id, and an error status would make a host that legitimately has no roster look
 * broken.
 */
function actorsRoute(deps: RouteDeps): AuditRoute {
  return {
    method: 'GET',
    path: '/audit-logs/actors',
    async handle(request: AuditRequest): Promise<AuditResponse> {
      try {
        const actor = await authorize(deps, request);
        return ok(await deps.store.listActors(actor.tenantId));
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

export function auditRoutes(deps: RouteDeps): AuditRoute[] {
  return [actorsRoute(deps), listRoute(deps)];
}
