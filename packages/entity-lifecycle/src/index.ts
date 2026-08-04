/**
 * @12-apps/entity-lifecycle — generic, portable entity-lifecycle machinery.
 *
 *   - Version history: diff-based (only what changed is stored), restorable to
 *     any version, with retention policies (age/count) and safe compaction.
 *   - Recycle bin: soft delete with a tree registry of what went along.
 *   - Drafts: one unpublished working copy per item.
 *   - Approvals: writes by non-approvers become pending change requests.
 *
 * Framework-free. Hosts implement the storage adapters (`LifecycleStores`) and
 * entity writes (`EntityOps`), then plug a collection in with ONE call:
 *
 *   const products = createEntityLifecycle(
 *     { entityType: 'product', features: { versioning: true, drafts: true, approvals: true },
 *       label: (s) => String(s.name ?? ''), retention: { maxVersions: 50, maxAgeDays: 365 } },
 *     stores,
 *     productOps,
 *   );
 */

export * from './types';
export { LifecycleError, type LifecycleErrorCode } from './errors';
export {
  diffSnapshots,
  jsonEquals,
  cloneJson,
  applyDelta,
  isEmptyDiff,
  sanitizeSnapshot,
  type SnapshotDiff,
} from './diff';
export {
  recordCreate,
  recordChange,
  materializeVersion,
  listHistory,
  applyRetention,
  type VersionSummary,
} from './versioning';
export { resolveFeature } from './features';
export { createEntityLifecycle, type EntityLifecycle } from './service';
export {
  createMemoryVersionStore,
  createMemoryRecycleBinStore,
  createMemoryDraftStore,
  createMemoryApprovalStore,
} from './memory';
