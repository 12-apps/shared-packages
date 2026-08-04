/**
 * Internal kernel shared by the lifecycle service's method groups: feature
 * gates, store/entity guards, and the three primitive write applications
 * (create / update / soft delete). `service.ts` composes the public API from
 * these; the drafts/approvals modules reuse them so every write — direct,
 * draft publish or approved change request — goes down the same funnel.
 */

import { LifecycleError } from './errors';
import { resolveFeature } from './features';
import { applyRetention, recordChange, recordCreate } from './versioning';
import type {
  ApprovalStore,
  ChangeRequestAction,
  DraftStore,
  EntityLifecycleConfig,
  EntityOps,
  EntityRef,
  FeatureDecision,
  LifecycleContext,
  LifecycleFeature,
  LifecycleStores,
  Snapshot,
  WriteResult,
} from './types';

interface KernelGuards {
  refOf(ctx: LifecycleContext, entityId: string): EntityRef;
  feature(ctx: LifecycleContext, key: LifecycleFeature): FeatureDecision;
  requireFeature(ctx: LifecycleContext, key: LifecycleFeature): void;
  /** Approvals intercept writes for actors without approve rights. */
  approvalsIntercept(ctx: LifecycleContext): boolean;
  requireApprovalStore(): ApprovalStore;
  requireDraftStore(): DraftStore;
  requireLiveSnapshot(ctx: LifecycleContext, entityId: string): Promise<Snapshot>;
  /** Park a write as a pending change request. */
  submitChange(
    ctx: LifecycleContext,
    action: ChangeRequestAction,
    entityId: string | null,
    payload: Snapshot,
  ): Promise<WriteResult>;
}

interface KernelAppliers {
  /** Perform a create for real, recording version 1 when versioning is on. */
  applyCreate(
    ctx: LifecycleContext,
    snapshot: Snapshot,
    actorId: string | null,
  ): Promise<WriteResult>;
  /** Perform an update for real, recording a delta when versioning is on. */
  applyUpdate(
    ctx: LifecycleContext,
    entityId: string,
    snapshot: Snapshot,
    actorId: string | null,
    restoredFromVersion?: number,
  ): Promise<WriteResult>;
  /** Archive + record the recycle-bin tree. */
  applySoftDelete(
    ctx: LifecycleContext,
    entityId: string,
    actorId: string | null,
  ): Promise<WriteResult>;
}

export interface LifecycleKernel extends KernelGuards, KernelAppliers {
  config: EntityLifecycleConfig;
  stores: LifecycleStores;
  ops: EntityOps;
}

function createGuards(
  config: EntityLifecycleConfig,
  stores: LifecycleStores,
  ops: EntityOps,
): KernelGuards {
  const guards: KernelGuards = {
    refOf: (ctx, entityId) => ({
      tenantId: ctx.tenantId,
      entityType: config.entityType,
      entityId,
    }),

    feature: (ctx, key) => resolveFeature(key, config, ctx.entitlements, ctx.settings),

    requireFeature(ctx, key) {
      const decision = guards.feature(ctx, key);
      if (!decision.enabled) {
        throw new LifecycleError(
          'FEATURE_DISABLED',
          `Feature "${key}" is not active for this tenant (${decision.reason}).`,
        );
      }
    },

    approvalsIntercept: (ctx) =>
      guards.feature(ctx, 'approvals').enabled && ctx.canApprove !== true,

    requireApprovalStore() {
      if (!stores.approvals) {
        throw new LifecycleError(
          'INVALID_STATE',
          `No approval store configured for "${config.entityType}".`,
        );
      }
      return stores.approvals;
    },

    requireDraftStore() {
      if (!stores.drafts) {
        throw new LifecycleError(
          'INVALID_STATE',
          `No draft store configured for "${config.entityType}".`,
        );
      }
      return stores.drafts;
    },

    async requireLiveSnapshot(ctx, entityId) {
      const snapshot = await ops.readSnapshot(ctx.tenantId, entityId);
      if (!snapshot) {
        throw new LifecycleError(
          'ENTITY_NOT_FOUND',
          `${config.entityType} ${entityId} not found.`,
        );
      }
      return snapshot;
    },

    async submitChange(ctx, action, entityId, payload) {
      const request = await guards.requireApprovalStore().create({
        tenantId: ctx.tenantId,
        entityType: config.entityType,
        entityId,
        action,
        payload,
        requestedBy: ctx.actorId,
      });
      return { status: 'pending-approval', requestId: request.id };
    },
  };
  return guards;
}

function createAppliers(
  config: EntityLifecycleConfig,
  stores: LifecycleStores,
  ops: EntityOps,
  guards: KernelGuards,
): KernelAppliers {
  return {
    async applyCreate(ctx, snapshot, actorId) {
      const entityId = await ops.applySnapshot(ctx.tenantId, null, snapshot);
      if (guards.feature(ctx, 'versioning').enabled) {
        const stored = (await ops.readSnapshot(ctx.tenantId, entityId)) ?? snapshot;
        const row = await recordCreate(
          stores.versions,
          guards.refOf(ctx, entityId),
          stored,
          actorId,
          config.diff,
        );
        await ops.onVersionRecorded?.(ctx.tenantId, entityId, row.version);
      }
      return { status: 'applied', entityId };
    },

    async applyUpdate(ctx, entityId, snapshot, actorId, restoredFromVersion) {
      const before = await guards.requireLiveSnapshot(ctx, entityId);
      await ops.applySnapshot(ctx.tenantId, entityId, snapshot);
      if (guards.feature(ctx, 'versioning').enabled) {
        const after = (await ops.readSnapshot(ctx.tenantId, entityId)) ?? snapshot;
        const row = await recordChange(
          stores.versions,
          guards.refOf(ctx, entityId),
          {
            before,
            after,
            kind: restoredFromVersion === undefined ? 'UPDATE' : 'RESTORE',
            actorId,
            restoredFromVersion,
          },
          config.diff,
        );
        if (row) await ops.onVersionRecorded?.(ctx.tenantId, entityId, row.version);
        if (config.retention) {
          await applyRetention(stores.versions, guards.refOf(ctx, entityId), config.retention);
        }
      }
      return { status: 'applied', entityId };
    },

    async applySoftDelete(ctx, entityId, actorId) {
      const snapshot = await guards.requireLiveSnapshot(ctx, entityId);
      const children = (await ops.collectChildren?.(ctx.tenantId, entityId)) ?? [];
      const archived = await ops.archive(ctx.tenantId, entityId);
      if (!archived) {
        throw new LifecycleError(
          'ENTITY_NOT_FOUND',
          `${config.entityType} ${entityId} not found.`,
        );
      }
      await stores.recycleBin.addTree(
        ctx.tenantId,
        {
          entityType: config.entityType,
          entityId,
          label: config.label(snapshot),
          snapshot,
          children,
        },
        actorId,
      );
      return { status: 'applied', entityId };
    },
  };
}

export function createKernel(
  config: EntityLifecycleConfig,
  stores: LifecycleStores,
  ops: EntityOps,
): LifecycleKernel {
  const guards = createGuards(config, stores, ops);
  return { config, stores, ops, ...guards, ...createAppliers(config, stores, ops, guards) };
}
