/**
 * The lifecycle service — the single object a host builds per collection to
 * plug versioning, recycle-bin soft delete, drafts and approvals into an
 * entity ("the HOC over a repository").
 *
 * Every mutation funnels through the host's {@link EntityOps} (via the shared
 * kernel), so once a collection is plugged in all business rules behave
 * identically to every other plugged collection: approvals intercept writes,
 * versions are recorded as diffs, deletions land in the recycle bin as a
 * tree, retention is applied opportunistically after each write.
 */

import { LifecycleError } from './errors';
import { createKernel, type LifecycleKernel } from './kernel';
import {
  createApprovalMethods,
  createDraftMethods,
  type ApprovalMethods,
  type DraftMethods,
} from './service-review';
import { listHistory, materializeVersion, type VersionSummary } from './versioning';
import type {
  EntityLifecycleConfig,
  EntityOps,
  FeatureDecision,
  LifecycleContext,
  LifecycleFeature,
  LifecycleStores,
  RecycleBinEntry,
  RecycleBinListFilter,
  Snapshot,
  WriteResult,
} from './types';

export interface EntityLifecycle extends DraftMethods, ApprovalMethods {
  readonly config: EntityLifecycleConfig;
  /** Resolve one feature for the calling tenant. */
  feature(ctx: LifecycleContext, feature: LifecycleFeature): FeatureDecision;

  // Writes (approvals-aware)
  create(ctx: LifecycleContext, snapshot: Snapshot): Promise<WriteResult>;
  update(ctx: LifecycleContext, entityId: string, snapshot: Snapshot): Promise<WriteResult>;
  softDelete(ctx: LifecycleContext, entityId: string): Promise<WriteResult>;

  // Version history
  history(ctx: LifecycleContext, entityId: string): Promise<VersionSummary[]>;
  versionState(ctx: LifecycleContext, entityId: string, version: number): Promise<Snapshot>;
  restoreVersion(ctx: LifecycleContext, entityId: string, version: number): Promise<WriteResult>;

  // Recycle bin
  listRecycleBin(ctx: LifecycleContext, filter?: RecycleBinListFilter): Promise<RecycleBinEntry[]>;
  recycleBinTree(ctx: LifecycleContext, entryId: string): Promise<RecycleBinEntry[]>;
  restoreDeleted(ctx: LifecycleContext, entryId: string): Promise<void>;
  purgeDeleted(ctx: LifecycleContext, entryId: string): Promise<void>;
}

/** The approvals-aware direct writes (also reused by the draft publisher). */
function createWriteMethods(kernel: LifecycleKernel) {
  return {
    async create(ctx: LifecycleContext, snapshot: Snapshot): Promise<WriteResult> {
      if (kernel.approvalsIntercept(ctx)) {
        return kernel.submitChange(ctx, 'CREATE', null, snapshot);
      }
      return kernel.applyCreate(ctx, snapshot, ctx.actorId);
    },

    async update(
      ctx: LifecycleContext,
      entityId: string,
      snapshot: Snapshot,
    ): Promise<WriteResult> {
      await kernel.requireLiveSnapshot(ctx, entityId);
      if (kernel.approvalsIntercept(ctx)) {
        return kernel.submitChange(ctx, 'UPDATE', entityId, snapshot);
      }
      return kernel.applyUpdate(ctx, entityId, snapshot, ctx.actorId);
    },

    async softDelete(ctx: LifecycleContext, entityId: string): Promise<WriteResult> {
      await kernel.requireLiveSnapshot(ctx, entityId);
      if (kernel.approvalsIntercept(ctx)) {
        return kernel.submitChange(ctx, 'DELETE', entityId, {});
      }
      return kernel.applySoftDelete(ctx, entityId, ctx.actorId);
    },
  };
}

/** Version-history reads + restore. */
function createVersionMethods(kernel: LifecycleKernel) {
  return {
    async history(ctx: LifecycleContext, entityId: string): Promise<VersionSummary[]> {
      kernel.requireFeature(ctx, 'versioning');
      return listHistory(kernel.stores.versions, kernel.refOf(ctx, entityId));
    },

    async versionState(
      ctx: LifecycleContext,
      entityId: string,
      version: number,
    ): Promise<Snapshot> {
      kernel.requireFeature(ctx, 'versioning');
      return materializeVersion(kernel.stores.versions, kernel.refOf(ctx, entityId), version);
    },

    async restoreVersion(
      ctx: LifecycleContext,
      entityId: string,
      version: number,
    ): Promise<WriteResult> {
      kernel.requireFeature(ctx, 'versioning');
      const target = await materializeVersion(
        kernel.stores.versions,
        kernel.refOf(ctx, entityId),
        version,
      );
      if (kernel.approvalsIntercept(ctx)) {
        return kernel.submitChange(ctx, 'UPDATE', entityId, target);
      }
      return kernel.applyUpdate(ctx, entityId, target, ctx.actorId, version);
    },
  };
}

/** Recycle-bin reads + restore/purge. Bin access is always on once plugged in. */
function createBinMethods(kernel: LifecycleKernel) {
  const requireDeletedTree = async (
    ctx: LifecycleContext,
    entryId: string,
  ): Promise<RecycleBinEntry[]> => {
    const tree = await kernel.stores.recycleBin.getTree(ctx.tenantId, entryId);
    const root = tree[0];
    if (!root) {
      throw new LifecycleError('ENTRY_NOT_FOUND', `Recycle-bin entry ${entryId} not found.`);
    }
    if (root.status !== 'DELETED') {
      throw new LifecycleError('INVALID_STATE', 'Only a deleted entry can be acted on.');
    }
    return tree;
  };

  return {
    async listRecycleBin(
      ctx: LifecycleContext,
      filter?: RecycleBinListFilter,
    ): Promise<RecycleBinEntry[]> {
      return kernel.stores.recycleBin.list(ctx.tenantId, {
        status: 'DELETED',
        rootsOnly: true,
        ...filter,
        entityType: kernel.config.entityType,
      });
    },

    async recycleBinTree(ctx: LifecycleContext, entryId: string): Promise<RecycleBinEntry[]> {
      const tree = await kernel.stores.recycleBin.getTree(ctx.tenantId, entryId);
      if (tree.length === 0) {
        throw new LifecycleError('ENTRY_NOT_FOUND', `Recycle-bin entry ${entryId} not found.`);
      }
      return tree;
    },

    async restoreDeleted(ctx: LifecycleContext, entryId: string): Promise<void> {
      const tree = await requireDeletedTree(ctx, entryId);
      const root = tree[0] as RecycleBinEntry;
      const restored = await kernel.ops.unarchive(ctx.tenantId, root.entityId);
      if (!restored) {
        throw new LifecycleError(
          'ENTITY_NOT_FOUND',
          `${kernel.config.entityType} ${root.entityId} no longer exists.`,
        );
      }
      await kernel.stores.recycleBin.setStatus(
        ctx.tenantId,
        tree.map((entry) => entry.id),
        'RESTORED',
      );
    },

    async purgeDeleted(ctx: LifecycleContext, entryId: string): Promise<void> {
      const tree = await requireDeletedTree(ctx, entryId);
      const root = tree[0] as RecycleBinEntry;
      await kernel.ops.hardDelete(ctx.tenantId, root.entityId);
      await kernel.stores.recycleBin.setStatus(
        ctx.tenantId,
        tree.map((entry) => entry.id),
        'PURGED',
      );
    },
  };
}

export function createEntityLifecycle(
  config: EntityLifecycleConfig,
  stores: LifecycleStores,
  ops: EntityOps,
): EntityLifecycle {
  const kernel = createKernel(config, stores, ops);
  const writes = createWriteMethods(kernel);
  return {
    config,
    feature: kernel.feature,
    ...writes,
    ...createVersionMethods(kernel),
    ...createBinMethods(kernel),
    ...createDraftMethods(kernel, writes),
    ...createApprovalMethods(kernel),
  };
}
