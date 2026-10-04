/**
 * Drafts of NEW items, as a collection a host OPTS into (FUT-3244).
 *
 * Every plugged collection can already start a new-item draft (`POST
 * /drafts`, `entityId: null`) — but nothing could write to it again, read it
 * back for the person who started it, or ever remove it. `upsertOpen` matches
 * on the entity id, and a new item has none, so a second save INSERTED a
 * second draft: an editor that saves as you type would leave one row per
 * keystroke, and none of them reachable.
 *
 * Opted in, a collection gets the three things such an editor needs:
 *
 *  - **update in place** — the draft is addressed by its own id, the only id a
 *    new item has (`updateNewDraft`);
 *  - **resume** — the caller's own newest open new-item draft, so "+ Novo"
 *    reopens it instead of starting another (`myNewDraft`);
 *  - **forget** — a new-item draft untouched for `staleAfterDays` (30) is
 *    hard-deleted by a sweep the host schedules (`sweepStaleNewDrafts`).
 *    Nothing else is swept: an item's draft, a published or discarded row,
 *    and every other collection's drafts are left exactly as they are.
 *
 * And one change to publishing: a new-item draft whose publish is parked for
 * approval becomes `SUBMITTED` rather than staying `OPEN`. The parked change
 * request carries the data now — the draft is not the person's working copy
 * any more, so it must not be resumed, published twice or swept from under
 * the request. Without the opt-in a parked publish keeps the draft OPEN, as
 * it always has.
 *
 * Opt-in because a host's surface is checked against what it advertises: a
 * collection that wires nothing gets no new route, no new tool, and no change.
 */

import { LifecycleError } from './errors';
import type { LifecycleKernel } from './kernel';
import type { DraftRecord, DraftStore, LifecycleContext, Snapshot, WriteResult } from './types';

/** The opt-in, on a collection's config (and its server registration). */
export interface NewItemDraftsOptions {
  /** Days a new-item draft may go untouched before the sweep deletes it. Default 30. */
  staleAfterDays?: number;
}

export const DEFAULT_STALE_AFTER_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * What a draft store adds to serve new-item drafts. Optional on the store a
 * host hands in (its own `DraftStore` keeps compiling); the package's Prisma
 * and memory stores implement all three.
 */
export interface NewItemDraftStore {
  /** Replace an OPEN draft's data in place; null when no OPEN draft has that id. */
  updateOpen(input: {
    tenantId: string;
    draftId: string;
    data: Snapshot;
    actorId: string | null;
  }): Promise<DraftRecord | null>;
  /** The newest OPEN new-item draft `actorId` started for this type, or null. */
  latestOpenNewBy(
    tenantId: string,
    entityType: string,
    actorId: string,
  ): Promise<DraftRecord | null>;
  /**
   * Hard-delete this type's OPEN new-item drafts last touched before
   * `before`, in EVERY tenant — the sweep is a job, not a request. Returns how
   * many went.
   */
  deleteOpenNewBefore(entityType: string, before: Date): Promise<number>;
}

export interface NewItemDraftMethods {
  /** Write `data` over an open NEW-item draft, by its id. */
  updateNewDraft(ctx: LifecycleContext, draftId: string, data: Snapshot): Promise<DraftRecord>;
  /** The caller's own newest open NEW-item draft, or null. */
  myNewDraft(ctx: LifecycleContext): Promise<DraftRecord | null>;
  /** Delete every tenant's new-item drafts untouched for `staleAfterDays`. */
  sweepStaleNewDrafts(now?: Date): Promise<number>;
}

/** The opt-in, or a refusal naming the collection that did not opt in. */
function requireOptIn(kernel: LifecycleKernel): NewItemDraftsOptions {
  const options = kernel.config.newItemDrafts;
  if (!options) {
    throw new LifecycleError(
      'FEATURE_DISABLED',
      `New-item drafts are not enabled for "${kernel.config.entityType}".`,
    );
  }
  return options;
}

/** The draft store, with the three methods this needs — or a configuration error. */
function requireStore(kernel: LifecycleKernel): DraftStore & NewItemDraftStore {
  const store = kernel.requireDraftStore();
  if (!store.updateOpen || !store.latestOpenNewBy || !store.deleteOpenNewBefore) {
    throw new LifecycleError(
      'INVALID_STATE',
      `The draft store for "${kernel.config.entityType}" cannot serve new-item drafts.`,
    );
  }
  return store as DraftStore & NewItemDraftStore;
}

export function createNewItemDraftMethods(kernel: LifecycleKernel): NewItemDraftMethods {
  const entityType = kernel.config.entityType;
  return {
    async updateNewDraft(ctx, draftId, data) {
      requireOptIn(kernel);
      kernel.requireFeature(ctx, 'drafts');
      const store = requireStore(kernel);
      const draft = await store.get(ctx.tenantId, draftId);
      if (!draft || draft.entityType !== entityType) {
        throw new LifecycleError('DRAFT_NOT_FOUND', `Draft ${draftId} not found.`);
      }
      if (draft.entityId !== null) {
        // An item's draft is saved on the item (`saveDraft`), which checks
        // the item is still there; this path would skip that check.
        throw new LifecycleError('INVALID_STATE', 'Only a new-item draft is updated by its id.');
      }
      // Guarded on OPEN in the write itself: a publish landing between the
      // read above and this write cannot be overwritten.
      const updated = await store.updateOpen({
        tenantId: ctx.tenantId,
        draftId,
        data,
        actorId: ctx.actorId,
      });
      if (!updated) throw new LifecycleError('INVALID_STATE', 'Only an open draft can be changed.');
      return updated;
    },

    async myNewDraft(ctx) {
      requireOptIn(kernel);
      kernel.requireFeature(ctx, 'drafts');
      const store = requireStore(kernel);
      // A system actor started nothing it could come back to.
      if (ctx.actorId === null) return null;
      return store.latestOpenNewBy(ctx.tenantId, entityType, ctx.actorId);
    },

    async sweepStaleNewDrafts(now = new Date()) {
      const options = requireOptIn(kernel);
      const days = options.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
      return requireStore(kernel).deleteOpenNewBefore(
        entityType,
        new Date(now.getTime() - days * DAY_MS),
      );
    },
  };
}

/**
 * After a publish: an opted-in NEW-item draft whose write was parked for
 * approval is `SUBMITTED` — the change request holds its data from here on.
 */
export async function settleNewItemPublish(
  kernel: LifecycleKernel,
  ctx: LifecycleContext,
  draft: DraftRecord,
  result: WriteResult,
): Promise<void> {
  if (!kernel.config.newItemDrafts || draft.entityId !== null) return;
  if (result.status !== 'pending-approval') return;
  await kernel.requireDraftStore().setStatus(ctx.tenantId, draft.id, 'SUBMITTED');
}
