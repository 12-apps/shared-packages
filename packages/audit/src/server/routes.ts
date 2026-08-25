/**
 * The audit surface's route DESCRIPTORS.
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
import type { AuditVocabulary } from '../core/vocabulary';

import {
  AuditApiError,
  foldApiError,
  ok,
  pageResponse,
  requirePermission,
  type AuditActor,
  type AuditGatePermissions,
  type AuditMessages,
  type AuditPagingPolicy,
  type AuditRequest,
  type AuditResponse,
  type AuditRoute,
  type AuditServerConfig,
} from './config';
import { messagesOf } from './policy';
import type { AuditStore } from './store';
import { parseAuditLogQuery } from './wire';

/**
 * What the descriptors run on — the RESOLVED policy, not the raw config.
 *
 * The messages, the gate ids and the paging numbers are resolved once by
 * `createApiAudit` (through `policy.ts`, which is where every refusal lives) and
 * handed over already-checked. Re-resolving them per request would move those
 * refusals onto the request path, where a host meets them as a 500 on one
 * endpoint instead of as a failure to boot.
 */
interface RouteDeps {
  config: Pick<AuditServerConfig, 'resolveActor' | 'messages'>;
  /**
   * The vocabulary, PLAIN — and deliberately not a copy source.
   *
   * Everything this half of the package reads off it is MECHANISM: `actionIds`
   * and `resourceIds` are the wire's allowed filter values, `allowlistFor`
   * decides which fields `redactDiff` persists to an append-only table, and
   * `hasAction`/`hasResource` are predicates over values off a wire. None of
   * that may follow a reader — a resolver here would make the wire CONTRACT
   * and the contents of an immutable row language-dependent, which is the
   * failure the "fixed text stays fixed" rule names.
   *
   * The label half (`actionLabel`, `resourceLabel`) is consumed only by the
   * React mount, where props are re-evaluated on every render — so a host that
   * wants its pills to follow a reader already can, by passing the vocabulary
   * its `useLocaleCopy` resolved. Nothing on the server ever renders a label.
   */
  vocabulary: AuditVocabulary;
  store: AuditStore;
  gates: AuditGatePermissions;
  paging: AuditPagingPolicy;
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
async function authorize(
  deps: RouteDeps,
  request: AuditRequest,
  messages: AuditMessages,
): Promise<AuditActor> {
  const actor = await deps.config.resolveActor(request);
  if (!actor) throw new AuditApiError(401, messages.unauthenticated);
  requirePermission(actor, deps.gates.read, messages);
  return actor;
}

function listRoute(deps: RouteDeps): AuditRoute {
  return {
    method: 'GET',
    path: '/audit-logs',
    async handle(request: AuditRequest): Promise<AuditResponse> {
      try {
        // Resolved ONCE per request, then handed down: two helpers asking
        // separately is how one refusal ends up half-translated.
        const messages = messagesOf(deps.config, request.locale);
        const actor = await authorize(deps, request, messages);
        const query = parseAuditLogQuery(
          deps.vocabulary,
          request.query,
          messages,
          deps.paging,
        );
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
        const actor = await authorize(deps, request, messagesOf(deps.config, request.locale));
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
