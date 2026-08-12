/**
 * The per-entity endpoints, GENERATED from one registration (12-17) — the
 * seven route files future-pay hand-wrote per collection, emitted here for
 * every entry of `config.entities`. Paths, statuses, envelopes and error
 * copy are byte-compatible with the future-pay originals, so the admin
 * screens (and their specs) port without edits.
 *
 * Route order is part of the surface: the literal `/drafts` routes are
 * emitted BEFORE the `/:id` ones so an adapter that mounts in array order can
 * never capture "drafts" as an entity id.
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

const ctxOf = (deps: EntityRouteDeps, actor: LifecycleActor): LifecycleContext =>
  contextOf(actor, deps.registration.approvePermission);

/**
 * `GET /:slug/:id/versions` — the entity's version history (newest first):
 * who changed what, when, and which fields each version touched. Backs the
 * reusable version-history dialog. 403 when versioning is off for the tenant.
 */
function versionsRoute(deps: EntityRouteDeps): LifecycleRoute {
  const { registration, lifecycle, directory, messages } = deps;
  return route('GET', `/${registration.slug}/:id/versions`, async ({ actor, params }) => {
    const id = requireParam(params, 'id', messages);
    const ctx = ctxOf(deps, actor);
    const history = await foldLifecycle(messages, () => lifecycle.history(ctx, id));
    const names = await resolveActorNames(directory, history.map((row) => row.actorId));
    const mirrored = registration.publishedVersion
      ? await registration.publishedVersion(actor.tenantId, id)
      : null;
    // Version rows exist only for APPLIED writes, so the highest recorded
    // version IS the live one whenever the host mirrors nothing.
    const publishedVersion = mirrored ?? history[0]?.version ?? 0;
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
      const version = Number.parseInt(requireParam(params, 'version', messages), 10);
      if (!Number.isInteger(version) || version < 1) {
        throw new LifecycleApiError(400, messages.invalidBody);
      }
      const ctx = ctxOf(deps, actor);
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
      const ctx = ctxOf(deps, actor);
      const draft = await foldLifecycle(messages, () => lifecycle.openDraft(ctx, id));
      return ok(draftJson(draft));
    }),
    route('PUT', `/${registration.slug}/:id/draft`, async ({ actor, params, body }) => {
      const id = requireParam(params, 'id', messages);
      const data = parseSnapshotBody(body, messages);
      const ctx = ctxOf(deps, actor);
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
      const ctx = ctxOf(deps, actor);
      const drafts = await foldLifecycle(messages, () => lifecycle.listDrafts(ctx));
      return ok({ drafts: drafts.map((draft) => draftJson(draft).draft) });
    }),
    route('POST', `/${registration.slug}/drafts`, async ({ actor, body }) => {
      const data = parseSnapshotBody(body, messages);
      const ctx = ctxOf(deps, actor);
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
      const ctx = ctxOf(deps, actor);
      const result = await foldLifecycle(messages, () => lifecycle.publishDraft(ctx, draftId));
      return writeResponse(result);
    }),
    route('DELETE', `/${registration.slug}/drafts/:draftId`, async ({ actor, params }) => {
      const draftId = requireParam(params, 'draftId', messages);
      const ctx = ctxOf(deps, actor);
      await foldLifecycle(messages, () => lifecycle.discardDraft(ctx, draftId));
      return noContent();
    }),
  ];
}

/** Every generated endpoint for one registration, in mount order. */
export function entityRoutes(deps: EntityRouteDeps): LifecycleRoute[] {
  return [
    // Literal segments first — `/drafts` must never be captured as an `:id`.
    ...draftCollectionRoutes(deps),
    ...draftItemRoutes(deps),
    ...itemDraftRoutes(deps),
    versionsRoute(deps),
    restoreRoute(deps),
  ];
}
