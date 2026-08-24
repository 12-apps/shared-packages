/**
 * The per-entity endpoints, GENERATED from one registration (12-17) — the
 * six route files the origin host hand-wrote per collection, emitted here for
 * every entry of `config.entities`. Paths, statuses, envelopes and error
 * copy match the origin host originals, so the admin screens (and their
 * specs) port without edits.
 *
 * Every route awaits the registration's gates before its handler runs:
 * `routePermission` (the origin host's `roles:manage` over the whole roles
 * surface) and then `authorize` (the host's per-collection plan gate) — the
 * same order the origin host evaluates them (route gate, then entitled context).
 *
 * Emission keeps the literal `/drafts` routes before the `/:id` ones. That is
 * a stability guarantee of the array, not a collision guard — no emitted pair
 * can shadow another (their segment counts differ). The collision that IS
 * real is host-vs-package: a host route shaped `/:slug/:id` registered before
 * this router captures `GET /:slug/drafts`. The wiring rule (mount the
 * package router first) lives in ADOPTING.md and is regression-tested in the
 * harness.
 */

import type { VersionComparison } from '../comparison';
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
  resolveLifecycleCopy,
  type LifecycleActor,
  type LifecycleMessages,
  type LifecycleCopySource,
  type LifecycleRequest,
  type LifecycleResponse,
  type LifecycleRoute,
  type LifecycleUserDirectory,
  parseSnapshotBody,
} from './context';
import type { LifecycleEntityRegistration } from './registration';
import type { VersionComparisonWire, VersionsWire } from '../wire';

/** What a HANDLER sees: this request's words, already chosen. */
interface EntityRouteDeps {
  registration: LifecycleEntityRegistration;
  lifecycle: EntityLifecycle;
  directory: LifecycleUserDirectory | undefined;
  messages: LifecycleMessages;
}

/**
 * What a BUILDER sees: the copy still as a source, because these routes are
 * built once per process and the reader changes per call.
 */
type EntityRouteConfig = Omit<EntityRouteDeps, 'messages'> & {
  messages: LifecycleCopySource<LifecycleMessages>;
};

/**
 * Wrap a handler so thrown {@link LifecycleApiError}s become responses, and so
 * it receives the copy for THIS caller.
 *
 * Resolving here is what makes the surface follow a reader: every helper below
 * still takes a plain `LifecycleMessages`, so nothing under this line had to
 * learn about locales — but none of them can be reached with the language the
 * process happened to boot with. `registration` and `lifecycle` stay bound at
 * BUILD time, correctly: neither varies per caller.
 */
function route(
  config: EntityRouteConfig,
  method: LifecycleRoute['method'],
  path: string,
  handler: (request: LifecycleRequest, deps: EntityRouteDeps) => Promise<LifecycleResponse>,
): LifecycleRoute {
  return {
    method,
    path,
    async handle(request) {
      try {
        return await handler(request, {
          ...config,
          messages: resolveLifecycleCopy(config.messages, request.locale),
        });
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
 * `?compare=N` — the version the caller wants read beside its neighbours.
 * Absent (the default) means the plain history list, which is the cheap read
 * every caller makes; a comparison materializes up to four versions.
 *
 * Strict digits, like the restore route: `parseInt` would accept "1.5" and
 * "1abc" and quietly compare v1 instead of answering 400.
 */
function requestedComparison(
  query: Record<string, string | undefined>,
  messages: LifecycleMessages,
): number | null {
  const raw = query.compare;
  if (raw === undefined || raw === '') return null;
  if (!/^[0-9]+$/.test(raw)) throw new LifecycleApiError(400, messages.invalidBody);
  const version = Number.parseInt(raw, 10);
  if (version < 1) throw new LifecycleApiError(400, messages.invalidBody);
  return version;
}

/** The comparison table for the wire: dates as ISO, actors resolved to names. */
function comparisonJson(
  comparison: VersionComparison,
  names: ReadonlyMap<string, string | null>,
): VersionComparisonWire {
  return {
    selectedVersion: comparison.selectedVersion,
    columns: comparison.columns.map((column) => ({
      version: column.version,
      roles: column.roles,
      kind: column.kind,
      actorId: column.actorId,
      actorName: column.actorId ? (names.get(column.actorId) ?? null) : null,
      createdAt: column.createdAt.toISOString(),
    })),
    rows: comparison.rows.map((row) => ({
      field: row.field,
      changed: row.changed,
      cells: row.cells.map((cell) => ({
        version: cell.version,
        present: cell.present,
        value: cell.value,
      })),
    })),
  };
}

/**
 * `GET /:slug/:id/versions` — the entity's version history (newest first):
 * who changed what, when, and which fields each version touched. Backs the
 * reusable version-history dialog. 403 when versioning is off for the tenant.
 *
 * With `?compare=N` it ALSO answers what N actually says, beside its previous
 * version, its next one and the current one (FUT-247) — the history list names
 * the fields a version touched, but a version row stores only the new values,
 * so "what did it say before" needs the chain replayed.
 */
function versionsRoute(config: EntityRouteConfig): LifecycleRoute {
  const { registration, lifecycle, directory } = config;
  return route(config, 'GET', `/${registration.slug}/:id/versions`, async ({ actor, params, query }, deps) => {
    const id = requireParam(params, 'id', deps.messages);
    const compare = requestedComparison(query, deps.messages);
    const ctx = await ctxOf(deps, actor);
    const history = await foldLifecycle(deps.messages, () => lifecycle.history(ctx, id));
    const names = await resolveActorNames(directory, history.map((row) => row.actorId));
    // A host that mirrors a published-version column is the authority on it —
    // including `null` (the entity is archived/gone), which the origin host's
    // soft-delete-filtered read answers as 0 so the dialog offers Restaurar
    // on every row. Only a host that mirrors NOTHING falls back to the
    // highest recorded version (version rows exist only for applied writes).
    const publishedVersion = registration.publishedVersion
      ? ((await registration.publishedVersion(actor.tenantId, id)) ?? 0)
      : (history[0]?.version ?? 0);
    // The host's published version is what "current" MEANS to this tenant, so
    // it is the comparison's current column rather than a second guess at it.
    const comparison =
      compare === null
        ? null
        : await foldLifecycle(deps.messages, () =>
            lifecycle.compareVersion(ctx, id, compare, { currentVersion: publishedVersion }),
          );
    const payload: VersionsWire = {
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
      // Absent, not null, when nothing was asked for: the plain list stays the
      // byte-for-byte answer it was before this endpoint learned to compare.
      ...(comparison ? { comparison: comparisonJson(comparison, names) } : {}),
    };
    return ok(payload);
  });
}

/**
 * `POST /:slug/:id/versions/:version/restore` — restore the entity to the
 * state of `version` (materialized by replaying the diff chain 1..N). Applies
 * immediately and records a RESTORE version — or, when approvals are active
 * and the actor cannot approve, parks the restore as a change request (202).
 */
function restoreRoute(config: EntityRouteConfig): LifecycleRoute {
  const { registration, lifecycle } = config;
  return route(
    config,
    'POST',
    `/${registration.slug}/:id/versions/:version/restore`,
    async ({ actor, params }, deps) => {
      const id = requireParam(params, 'id', deps.messages);
      // Strict digits only — `parseInt` would accept "1.5"/"1abc" and
      // silently restore v1; the origin host's zod coercion answers 400.
      const raw = requireParam(params, 'version', deps.messages);
      if (!/^[0-9]+$/.test(raw)) throw new LifecycleApiError(400, deps.messages.invalidBody);
      const version = Number.parseInt(raw, 10);
      if (version < 1) throw new LifecycleApiError(400, deps.messages.invalidBody);
      const ctx = await ctxOf(deps, actor);
      const result = await foldLifecycle(deps.messages, () =>
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
function itemDraftRoutes(config: EntityRouteConfig): LifecycleRoute[] {
  const { registration, lifecycle } = config;
  return [
    route(config, 'GET', `/${registration.slug}/:id/draft`, async ({ actor, params }, deps) => {
      const id = requireParam(params, 'id', deps.messages);
      const ctx = await ctxOf(deps, actor);
      const draft = await foldLifecycle(deps.messages, () => lifecycle.openDraft(ctx, id));
      return ok(draftJson(draft));
    }),
    route(config, 'PUT', `/${registration.slug}/:id/draft`, async ({ actor, params, body }, deps) => {
      const id = requireParam(params, 'id', deps.messages);
      const data = parseSnapshotBody(body, deps.messages);
      const ctx = await ctxOf(deps, actor);
      const draft = await foldLifecycle(deps.messages, () => lifecycle.saveDraft(ctx, id, data));
      return ok(draftJson(draft));
    }),
  ];
}

/**
 * `GET/POST /:slug/drafts` — the tenant's OPEN drafts for this collection.
 * GET lists them (per-item drafts AND drafts of new, not-yet-created items);
 * POST starts a NEW-item draft (`entityId: null`).
 */
function draftCollectionRoutes(config: EntityRouteConfig): LifecycleRoute[] {
  const { registration, lifecycle } = config;
  return [
    route(config, 'GET', `/${registration.slug}/drafts`, async ({ actor }, deps) => {
      const ctx = await ctxOf(deps, actor);
      const drafts = await foldLifecycle(deps.messages, () => lifecycle.listDrafts(ctx));
      return ok({ drafts: drafts.map((draft) => draftJson(draft).draft) });
    }),
    route(config, 'POST', `/${registration.slug}/drafts`, async ({ actor, body }, deps) => {
      const data = parseSnapshotBody(body, deps.messages);
      const ctx = await ctxOf(deps, actor);
      const draft = await foldLifecycle(deps.messages, () => lifecycle.saveDraft(ctx, null, data));
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
function draftItemRoutes(config: EntityRouteConfig): LifecycleRoute[] {
  const { registration, lifecycle } = config;
  return [
    route(config, 'POST', `/${registration.slug}/drafts/:draftId/publish`, async ({ actor, params }, deps) => {
      const draftId = requireParam(params, 'draftId', deps.messages);
      const ctx = await ctxOf(deps, actor);
      const result = await foldLifecycle(deps.messages, () => lifecycle.publishDraft(ctx, draftId));
      return writeResponse(result);
    }),
    route(config, 'DELETE', `/${registration.slug}/drafts/:draftId`, async ({ actor, params }, deps) => {
      const draftId = requireParam(params, 'draftId', deps.messages);
      const ctx = await ctxOf(deps, actor);
      await foldLifecycle(deps.messages, () => lifecycle.discardDraft(ctx, draftId));
      return noContent();
    }),
  ];
}

/** Every generated endpoint for one registration, in mount order. */
export function entityRoutes(config: EntityRouteConfig): LifecycleRoute[] {
  return [
    // Literal segments first. A stable, readable emission order — not a
    // collision guard: no two paths here can shadow each other (`/x/drafts` is
    // two segments, `/x/:id/draft` three). The order that DOES decide a winner
    // is the host's, between this router and its own `/:slug/:id` routes
    // (ADOPTING rule 7).
    ...draftCollectionRoutes(config),
    ...draftItemRoutes(config),
    ...itemDraftRoutes(config),
    versionsRoute(config),
    restoreRoute(config),
  ];
}
