/**
 * The per-entity endpoints, GENERATED from one registration (12-17) — the
 * six route files future-pay hand-wrote per collection, emitted here for
 * every entry of `config.entities`. Paths, statuses, envelopes and error
 * copy match the future-pay originals, so the admin screens (and their
 * specs) port without edits.
 *
 * Every route awaits the registration's gates before its handler runs:
 * `routePermission` (future-pay's `roles:manage` over the whole roles
 * surface) and then `authorize` (the host's per-collection plan gate) — the
 * same order future-pay evaluates them (route gate, then entitled context).
 *
 * Emission keeps the literal `/drafts` routes before the `/:id` ones. That is
 * a stability guarantee of the array, not a collision guard — no emitted pair
 * can shadow another (their segment counts differ). The collision that IS
 * real is host-vs-package: a host route shaped `/:slug/:id` registered before
 * this router captures `GET /:slug/drafts`. The wiring rule (mount the
 * package router first) lives in ADOPTING.md and is regression-tested in the
 * harness.
 */

import type { EntityLifecycle } from '../service';
import type { LifecycleContext } from '../types';

import {
  contextOf,
  draftJson,
  foldApiError,
  foldLifecycle,
  noContent,
  ok,
  requireAuthorized,
  requireRoutePermission,
  resolveActorNames,
  writeResponse,
  LifecycleApiError,
  type LifecycleActor,
  type LifecycleMessages,
  type LifecycleRequest,
  type LifecycleResponse,
  type LifecycleRoute,
  type LifecycleUserDirectory,
  parseSnapshotBody,
} from './context';
import type { LifecycleEntityRegistration } from './registration';

interface EntityRouteDeps {
  registration: LifecycleEntityRegistration;
  lifecycle: EntityLifecycle;
  directory: LifecycleUserDirectory | undefined;
  messages: LifecycleMessages;
}

/** Wrap a handler so thrown {@link LifecycleApiError}s become responses. */
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

function requireParam(
  params: Record<string, string | undefined>,
  key: string,
  messages: LifecycleMessages,
): string {
  const value = params[key];
  if (!value) throw new LifecycleApiError(400, messages.invalidBody);
  return value;
}

/**
 * The registration's gates, then the per-request context — every
 * collection-scoped handler starts here, so no generated endpoint can be
 * reached past a route permission or an unanswered plan gate.
 */
async function ctxOf(deps: EntityRouteDeps, actor: LifecycleActor): Promise<LifecycleContext> {
  requireRoutePermission(actor, deps.registration.routePermission, deps.messages);
  await requireAuthorized(actor, deps.registration.authorize, deps.messages);
  return contextOf(actor, deps.registration.approvePermission);
}

/**
 * `GET /:slug/:id/versions` — the entity's version history (newest first):
 * who changed what, when, and which fields each version touched. Backs the
 * reusable version-history dialog. 403 when versioning is off for the tenant.
 */
function versionsRoute(deps: EntityRouteDeps): LifecycleRoute {
  const { registration, lifecycle, directory, messages } = deps;
  return route('GET', `/${registration.slug}/:id/versions`, async ({ actor, params }) => {
    const id = requireParam(params, 'id', messages);
    const ctx = await ctxOf(deps, actor);
    const history = await foldLifecycle(messages, () => lifecycle.history(ctx, id));
    const names = await resolveActorNames(directory, history.map((row) => row.actorId));
    // A host that mirrors a published-version column is the authority on it —
    // including `null` (the entity is archived/gone), which future-pay's
    // soft-delete-filtered read answers as 0 so the dialog offers Restaurar
    // on every row. Only a host that mirrors NOTHING falls back to the
    // highest recorded version (version rows exist only for applied writes).
    const publishedVersion = registration.publishedVersion
      ? ((await registration.publishedVersion(actor.tenantId, id)) ?? 0)
      : (history[0]?.version ?? 0);
    return ok({
      versions: history.map((row) => ({
        version: row.version,
        kind: row.kind,
        actorId: row.actorId,
        actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
        changedFields: row.changedFields,
        removedFields: row.removedFields,
        restoredFromVersion: row.restoredFromVersion,
      })),
      publishedVersion,
    });
  });
}

/**
 * `POST /:slug/:id/versions/:version/restore` — restore the entity to the
 * state of `version` (materialized by replaying the diff chain 1..N). Applies
 * immediately and records a RESTORE version — or, when approvals are active
 * and the actor cannot approve, parks the restore as a change request (202).
 */
function restoreRoute(deps: EntityRouteDeps): LifecycleRoute {
  const { registration, lifecycle, messages } = deps;
  return route(
    'POST',
    `/${registration.slug}/:id/versions/:version/restore`,
    async ({ actor, params }) => {
      const id = requireParam(params, 'id', messages);
      // Strict digits only — `parseInt` would accept "1.5"/"1abc" and
      // silently restore v1; future-pay's zod coercion answers 400.
      const raw = requireParam(params, 'version', messages);
      if (!/^[0-9]+$/.test(raw)) throw new LifecycleApiError(400, messages.invalidBody);
      const version = Number.parseInt(raw, 10);
      if (version < 1) throw new LifecycleApiError(400, messages.invalidBody);
      const ctx = await ctxOf(deps, actor);
      const result = await foldLifecycle(messages, () =>
        lifecycle.restoreVersion(ctx, id, version),
      );
      return writeResponse(result);
    },
  );
}

/**
 * `GET/PUT /:slug/:id/draft` — the entity's OPEN draft (unpublished working
 * copy kept next to the live record). GET returns it (or null); PUT
 * creates/updates it WITHOUT touching the live record. 403 when drafts are
 * off for the tenant.
 */
function itemDraftRoutes(deps: EntityRouteDeps): LifecycleRoute[] {
  const { registration, lifecycle, messages } = deps;
  return [
    route('GET', `/${registration.slug}/:id/draft`, async ({ actor, params }) => {
      const id = requireParam(params, 'id', messages);
      const ctx = await ctxOf(deps, actor);
      const draft = await foldLifecycle(messages, () => lifecycle.openDraft(ctx, id));
      return ok(draftJson(draft));
    }),
    route('PUT', `/${registration.slug}/:id/draft`, async ({ actor, params, body }) => {
      const id = requireParam(params, 'id', messages);
      const data = parseSnapshotBody(body, messages);
      const ctx = await ctxOf(deps, actor);
      const draft = await foldLifecycle(messages, () => lifecycle.saveDraft(ctx, id, data));
      return ok(draftJson(draft));
    }),
  ];
}

/**
 * `GET/POST /:slug/drafts` — the tenant's OPEN drafts for this collection.
 * GET lists them (per-item drafts AND drafts of new, not-yet-created items);
 * POST starts a NEW-item draft (`entityId: null`).
 */
function draftCollectionRoutes(deps: EntityRouteDeps): LifecycleRoute[] {
  const { registration, lifecycle, messages } = deps;
  return [
    route('GET', `/${registration.slug}/drafts`, async ({ actor }) => {
      const ctx = await ctxOf(deps, actor);
      const drafts = await foldLifecycle(messages, () => lifecycle.listDrafts(ctx));
      return ok({ drafts: drafts.map((draft) => draftJson(draft).draft) });
    }),
    route('POST', `/${registration.slug}/drafts`, async ({ actor, body }) => {
      const data = parseSnapshotBody(body, messages);
      const ctx = await ctxOf(deps, actor);
      const draft = await foldLifecycle(messages, () => lifecycle.saveDraft(ctx, null, data));
      return ok(draftJson(draft));
    }),
  ];
}

/**
 * `DELETE /:slug/drafts/:draftId` — discard a draft (the live record is
 * untouched; the row is kept as DISCARDED history). Bodyless 204, matching
 * the declared MCP contract.
 *
 * `POST /:slug/drafts/:draftId/publish` — publish a draft onto the live
 * record (an update), or CREATE the record for a new-item draft. A normal
 * lifecycle write: records a version, or parks for approval (202, draft
 * stays OPEN until applied).
 */
function draftItemRoutes(deps: EntityRouteDeps): LifecycleRoute[] {
  const { registration, lifecycle, messages } = deps;
  return [
    route('POST', `/${registration.slug}/drafts/:draftId/publish`, async ({ actor, params }) => {
      const draftId = requireParam(params, 'draftId', messages);
      const ctx = await ctxOf(deps, actor);
      const result = await foldLifecycle(messages, () => lifecycle.publishDraft(ctx, draftId));
      return writeResponse(result);
    }),
    route('DELETE', `/${registration.slug}/drafts/:draftId`, async ({ actor, params }) => {
      const draftId = requireParam(params, 'draftId', messages);
      const ctx = await ctxOf(deps, actor);
      await foldLifecycle(messages, () => lifecycle.discardDraft(ctx, draftId));
      return noContent();
    }),
  ];
}

/** Every generated endpoint for one registration, in mount order. */
export function entityRoutes(deps: EntityRouteDeps): LifecycleRoute[] {
  return [
    // Literal segments first. A stable, readable emission order — not a
    // collision guard: no two paths here can shadow each other (`/x/drafts` is
    // two segments, `/x/:id/draft` three). The order that DOES decide a winner
    // is the host's, between this router and its own `/:slug/:id` routes
    // (ADOPTING rule 7).
    ...draftCollectionRoutes(deps),
    ...draftItemRoutes(deps),
    ...itemDraftRoutes(deps),
    versionsRoute(deps),
    restoreRoute(deps),
  ];
}
