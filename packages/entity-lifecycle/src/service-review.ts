/**
 * Draft + approval method groups of the lifecycle service, composed over the
 * shared {@link LifecycleKernel} (and, for draft publishing, the service's own
 * approvals-aware create/update so a publish behaves exactly like a direct
 * write).
 */

import { LifecycleError } from './errors';
import type { LifecycleKernel } from './kernel';
import type {
  ChangeRequestListFilter,
  ChangeRequestRecord,
  DraftRecord,
  LifecycleContext,
  Snapshot,
  WriteResult,
} from './types';

export interface DraftMethods {
  saveDraft(ctx: LifecycleContext, entityId: string | null, data: Snapshot): Promise<DraftRecord>;
  openDraft(ctx: LifecycleContext, entityId: string): Promise<DraftRecord | null>;
  listDrafts(ctx: LifecycleContext): Promise<DraftRecord[]>;
  publishDraft(ctx: LifecycleContext, draftId: string): Promise<WriteResult>;
  discardDraft(ctx: LifecycleContext, draftId: string): Promise<void>;
}

export interface ApprovalMethods {
  listChangeRequests(
    ctx: LifecycleContext,
    filter?: Omit<ChangeRequestListFilter, 'entityType'>,
  ): Promise<ChangeRequestRecord[]>;
  approveChange(ctx: LifecycleContext, requestId: string): Promise<WriteResult>;
  rejectChange(ctx: LifecycleContext, requestId: string, note?: string): Promise<void>;
}

/** The approvals-aware writes the draft publisher delegates to. */
interface PublishWrites {
  create(ctx: LifecycleContext, snapshot: Snapshot): Promise<WriteResult>;
  update(ctx: LifecycleContext, entityId: string, snapshot: Snapshot): Promise<WriteResult>;
}

export function createDraftMethods(
  kernel: LifecycleKernel,
  writes: PublishWrites,
): DraftMethods {
  const requireOpenDraft = async (
    ctx: LifecycleContext,
    draftId: string,
  ): Promise<DraftRecord> => {
    const draft = await kernel.requireDraftStore().get(ctx.tenantId, draftId);
    if (!draft || draft.entityType !== kernel.config.entityType) {
      throw new LifecycleError('DRAFT_NOT_FOUND', `Draft ${draftId} not found.`);
    }
    if (draft.status !== 'OPEN') {
      throw new LifecycleError('INVALID_STATE', 'Only an open draft can be changed.');
    }
    return draft;
  };

  return {
    async saveDraft(ctx, entityId, data) {
      kernel.requireFeature(ctx, 'drafts');
      if (entityId !== null) await kernel.requireLiveSnapshot(ctx, entityId);
      return kernel.requireDraftStore().upsertOpen({
        tenantId: ctx.tenantId,
        entityType: kernel.config.entityType,
        entityId,
        data,
        actorId: ctx.actorId,
      });
    },

    async openDraft(ctx, entityId) {
      kernel.requireFeature(ctx, 'drafts');
      return kernel
        .requireDraftStore()
        .getOpenFor(ctx.tenantId, kernel.config.entityType, entityId);
    },

    async listDrafts(ctx) {
      kernel.requireFeature(ctx, 'drafts');
      return kernel.requireDraftStore().listOpen(ctx.tenantId, kernel.config.entityType);
    },

    async publishDraft(ctx, draftId) {
      kernel.requireFeature(ctx, 'drafts');
      const draft = await requireOpenDraft(ctx, draftId);
      const result =
        draft.entityId === null
          ? await writes.create(ctx, draft.data)
          : await writes.update(ctx, draft.entityId, draft.data);
      // A publish intercepted by approvals keeps the draft OPEN — it becomes
      // published only when the change is actually applied.
      if (result.status === 'applied') {
        await kernel.requireDraftStore().setStatus(ctx.tenantId, draftId, 'PUBLISHED');
      }
      return result;
    },

    async discardDraft(ctx, draftId) {
      kernel.requireFeature(ctx, 'drafts');
      await requireOpenDraft(ctx, draftId);
      await kernel.requireDraftStore().setStatus(ctx.tenantId, draftId, 'DISCARDED');
    },
  };
}

const alreadyDecided = (): LifecycleError =>
  new LifecycleError('REQUEST_ALREADY_DECIDED', 'Change request already decided.');

async function requirePendingRequest(
  kernel: LifecycleKernel,
  ctx: LifecycleContext,
  requestId: string,
): Promise<ChangeRequestRecord> {
  kernel.requireFeature(ctx, 'approvals');
  if (ctx.canApprove !== true) {
    throw new LifecycleError('NOT_AUTHORIZED', 'Actor may not decide change requests.');
  }
  const request = await kernel.requireApprovalStore().get(ctx.tenantId, requestId);
  if (!request || request.entityType !== kernel.config.entityType) {
    throw new LifecycleError('REQUEST_NOT_FOUND', `Change request ${requestId} not found.`);
  }
  if (request.status !== 'PENDING') throw alreadyDecided();
  return request;
}

/** Apply the parked write, attributed to the change AUTHOR (requestedBy). */
async function applyRequest(
  kernel: LifecycleKernel,
  ctx: LifecycleContext,
  request: ChangeRequestRecord,
): Promise<WriteResult> {
  if (request.action === 'CREATE') {
    return kernel.applyCreate(ctx, request.payload, request.requestedBy);
  }
  if (!request.entityId) {
    throw new LifecycleError('INVALID_STATE', `${request.action} request without an entity id.`);
  }
  return request.action === 'UPDATE'
    ? kernel.applyUpdate(ctx, request.entityId, request.payload, request.requestedBy)
    : kernel.applySoftDelete(ctx, request.entityId, request.requestedBy);
}

export function createApprovalMethods(kernel: LifecycleKernel): ApprovalMethods {
  return {
    async listChangeRequests(ctx, filter) {
      kernel.requireFeature(ctx, 'approvals');
      return kernel.requireApprovalStore().list(ctx.tenantId, {
        ...filter,
        entityType: kernel.config.entityType,
      });
    },

    async approveChange(ctx, requestId) {
      const request = await requirePendingRequest(kernel, ctx, requestId);
      // CLAIM before applying: `decide` is a compare-and-set on PENDING, so of
      // two concurrent approvers exactly ONE wins and applies — the parked
      // write can never run twice.
      const store = kernel.requireApprovalStore();
      const claimed = await store.decide(ctx.tenantId, requestId, {
        status: 'APPROVED',
        decidedBy: ctx.actorId,
        decisionNote: null,
      });
      if (!claimed) throw alreadyDecided();
      // If applying fails, the claim is compensated back to PENDING so the
      // request stays retryable instead of stranding approved-but-unapplied.
      try {
        return await applyRequest(kernel, ctx, request);
      } catch (error) {
        await store.reopen(ctx.tenantId, requestId);
        throw error;
      }
    },

    async rejectChange(ctx, requestId, note) {
      const request = await requirePendingRequest(kernel, ctx, requestId);
      // Compare-and-set: a concurrent decision loses cleanly rather than
      // double-recording.
      const rejected = await kernel.requireApprovalStore().decide(ctx.tenantId, request.id, {
        status: 'REJECTED',
        decidedBy: ctx.actorId,
        decisionNote: note ?? null,
      });
      if (!rejected) throw alreadyDecided();
    },
  };
}
