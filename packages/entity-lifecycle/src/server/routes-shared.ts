/**
 * The cross-collection surfaces (12-17): the tenant's recycle bin and its
 * approvals inbox. Both dispatch through the registration map — a bin entry
 * or change request knows its own `entityType`, and the action is decided
 * against THAT collection's lifecycle and approve permission (a category
 * request is decided against `categories:approve`, not the product one).
 * Ported from the origin host's `recycle-bin/**` and `approvals/**` routes.
 */

import type { EntityLifecycle } from '../service';
import type { ApprovalStore, RecycleBinStore } from '../types';

import {
  contextOf,
  foldApiError,
  foldLifecycle,
  noContent,
  ok,
  parseRejectBody,
  requireAuthorized,
  resolveActorNames,
  writeOutcome,
  LifecycleApiError,
  type LifecycleActor,
  type LifecycleMessages,
  type LifecycleRequest,
  type LifecycleResponse,
  type LifecycleRoute,
  type LifecycleUserDirectory,
} from './context';
import type { LifecycleEntityRegistration } from './registration';

export interface RegisteredEntity {
  registration: LifecycleEntityRegistration;
  lifecycle: EntityLifecycle;
}

interface SharedRouteDeps {
  entities: ReadonlyMap<string, RegisteredEntity>;
  recycleBin: RecycleBinStore;
  approvals: ApprovalStore;
  directory: LifecycleUserDirectory | undefined;
  messages: LifecycleMessages;
}

function route(
  method: LifecycleRoute['method'],
  path: string,
  handler: (request: LifecycleRequest) => Promise<LifecycleResponse>,
): LifecycleRoute {
  return {
    method,
    path,
    async handle(request) {
      try {
        return await handler(request);
      } catch (error) {
        return foldApiError(error);
      }
    },
  };
}

/** The registered collection an entry/request belongs to — 422 for strays. */
function entityOf(deps: SharedRouteDeps, entityType: string): RegisteredEntity {
  const entry = deps.entities.get(entityType);
  if (!entry) throw new LifecycleApiError(422, deps.messages.unknownEntityType);
  return entry;
}

/**
 * Resolve the entry/request's own collection and build its context — AWAITING
 * that collection's `authorize` gate first. These paths carry no collection
 * prefix (the collection is known only after reading the row), so this is the
 * only place its plan gate can run: without it, a tenant whose `suppliers`
 * plan is off could still purge a binned supplier or decide its requests.
 * `routePermission` deliberately does NOT apply here — parity with
 * the origin host, where the bin and the inbox require the admin tier, never the
 * collection's route permission.
 */
const dispatchContext = async (
  deps: SharedRouteDeps,
  entityType: string,
  actor: LifecycleActor,
): Promise<{ entity: RegisteredEntity; ctx: ReturnType<typeof contextOf> }> => {
  const entity = entityOf(deps, entityType);
  await requireAuthorized(actor, entity.registration.authorize, deps.messages);
  return { entity, ctx: contextOf(actor, entity.registration.approvePermission) };
};

/**
 * `GET /recycle-bin` — every soft-deleted item of the tenant (across ALL
 * registered collections; `?entityType=` narrows to one), newest first, each
 * root with its registered dependent tree so the page can show what a restore
 * brings back. Only DELETED entries are listed — restored/purged rows stay in
 * the table as an audit trail but leave the bin.
 *
 * The list is deliberately NOT run through a collection's `authorize` gate: it
 * spans every registered collection at once, and the origin host's twin gates it
 * the same way (the admin tier for the page, nothing per collection). The
 * per-collection gate lands on the item routes below, where the row names the
 * collection.
 */
function binListRoute(deps: SharedRouteDeps): LifecycleRoute {
  return route('GET', '/recycle-bin', async ({ actor, query }) => {
    // An EMPTY `?entityType=` is a malformed filter, not an absent one —
    // the origin host's `z.string().min(1).optional()` answers 400 rather than
    // silently listing every collection.
    if (query.entityType === '') throw new LifecycleApiError(400, deps.messages.invalidBody);
    const roots = await deps.recycleBin.list(actor.tenantId, {
      status: 'DELETED',
      rootsOnly: true,
      ...(query.entityType !== undefined ? { entityType: query.entityType } : {}),
    });
    const names = await resolveActorNames(deps.directory, roots.map((entry) => entry.deletedBy));
    const entries = await Promise.all(
      roots.map(async (entry) => {
        const tree = await deps.recycleBin.getTree(actor.tenantId, entry.id);
        return {
          id: entry.id,
          entityType: entry.entityType,
          entityId: entry.entityId,
          label: entry.label,
          deletedBy: entry.deletedBy,
          deletedByName: entry.deletedBy ? (names.get(entry.deletedBy) ?? null) : null,
          deletedAt: entry.deletedAt.toISOString(),
          status: entry.status,
          children: tree
            .filter((node) => node.id !== entry.id)
            .map((node) => ({ id: node.id, entityType: node.entityType, label: node.label })),
        };
      }),
    );
    return ok({ entries });
  });
}

/**
 * `POST /recycle-bin/:entryId/restore` — bring a soft-deleted item back
 * (un-archive the live record, flip the entry tree to RESTORED), dispatched
 * to the entry's own collection so restore behaves identically everywhere.
 *
 * `DELETE /recycle-bin/:entryId` — PERMANENTLY delete a binned item ("excluir
 * definitivamente"): the hard delete removes the record and its satellites;
 * the bin row is kept, flipped to PURGED (audit trail). Both bodyless 204.
 */
function binItemRoutes(deps: SharedRouteDeps): LifecycleRoute[] {
  const { messages } = deps;
  const rootOf = async (tenantId: string, entryId: string | undefined) => {
    if (!entryId) throw new LifecycleApiError(400, messages.invalidBody);
    const tree = await deps.recycleBin.getTree(tenantId, entryId);
    const root = tree[0];
    if (!root) throw new LifecycleApiError(404, messages.entryNotFound);
    return root;
  };
  return [
    route('POST', '/recycle-bin/:entryId/restore', async ({ actor, params }) => {
      const root = await rootOf(actor.tenantId, params.entryId);
      const { entity, ctx } = await dispatchContext(deps, root.entityType, actor);
      await foldLifecycle(messages, () => entity.lifecycle.restoreDeleted(ctx, root.id));
      return noContent();
    }),
    route('DELETE', '/recycle-bin/:entryId', async ({ actor, params }) => {
      const root = await rootOf(actor.tenantId, params.entryId);
      const { entity, ctx } = await dispatchContext(deps, root.entityType, actor);
      await foldLifecycle(messages, () => entity.lifecycle.purgeDeleted(ctx, root.id));
      return noContent();
    }),
  ];
}

const APPROVAL_STATUSES = new Set(['PENDING', 'APPROVED', 'REJECTED']);

/**
 * `GET /approvals` — the tenant's change requests (across every registered
 * collection), default PENDING. Each request carries a human label derived
 * from its payload so the inbox reads "Suco de laranja — alteração" rather
 * than UUIDs.
 */
function approvalsListRoute(deps: SharedRouteDeps): LifecycleRoute {
  return route('GET', '/approvals', async ({ actor, query }) => {
    const status = query.status ?? 'PENDING';
    if (!APPROVAL_STATUSES.has(status)) {
      throw new LifecycleApiError(400, deps.messages.invalidBody);
    }
    const requests = await deps.approvals.list(actor.tenantId, {
      status: status as 'PENDING' | 'APPROVED' | 'REJECTED',
    });
    const names = await resolveActorNames(
      deps.directory,
      requests.map((request) => request.requestedBy),
    );
    return ok({
      requests: requests.map((request) => ({
        id: request.id,
        entityType: request.entityType,
        entityId: request.entityId,
        action: request.action,
        label:
          typeof request.payload.name === 'string' && request.payload.name.length > 0
            ? request.payload.name
            : (request.entityId ?? '—'),
        status: request.status,
        requestedBy: request.requestedBy,
        requestedByName: request.requestedBy
          ? (names.get(request.requestedBy) ?? null)
          : null,
        requestedAt: request.requestedAt.toISOString(),
        decidedBy: request.decidedBy,
        decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
        decisionNote: request.decisionNote,
      })),
    });
  });
}

/**
 * `POST /approvals/:requestId/approve` — approve a pending change request and
 * apply the parked write (create/update/delete), attributed to the AUTHOR.
 * Requires the collection's own approve permission; a non-approver gets the
 * user-safe 403; a lost decide race is the 409.
 *
 * `POST /approvals/:requestId/reject` — reject with an optional note; the
 * live record stays untouched, the request is kept as REJECTED history (204).
 */
function approvalItemRoutes(deps: SharedRouteDeps): LifecycleRoute[] {
  const { messages } = deps;
  const requestOf = async (tenantId: string, requestId: string | undefined) => {
    if (!requestId) throw new LifecycleApiError(400, messages.invalidBody);
    const request = await deps.approvals.get(tenantId, requestId);
    if (!request) throw new LifecycleApiError(404, messages.requestNotFound);
    return request;
  };
  return [
    route('POST', '/approvals/:requestId/approve', async ({ actor, params }) => {
      const request = await requestOf(actor.tenantId, params.requestId);
      const { entity, ctx } = await dispatchContext(deps, request.entityType, actor);
      const result = await foldLifecycle(messages, () =>
        entity.lifecycle.approveChange(ctx, request.id),
      );
      return ok(writeOutcome(result));
    }),
    route('POST', '/approvals/:requestId/reject', async ({ actor, params, body }) => {
      const note = parseRejectBody(body, messages);
      const request = await requestOf(actor.tenantId, params.requestId);
      const { entity, ctx } = await dispatchContext(deps, request.entityType, actor);
      await foldLifecycle(messages, () => entity.lifecycle.rejectChange(ctx, request.id, note));
      return noContent();
    }),
  ];
}

/** The shared surfaces, in mount order. */
export function sharedRoutes(deps: SharedRouteDeps): LifecycleRoute[] {
  return [
    binListRoute(deps),
    ...binItemRoutes(deps),
    approvalsListRoute(deps),
    ...approvalItemRoutes(deps),
  ];
}
