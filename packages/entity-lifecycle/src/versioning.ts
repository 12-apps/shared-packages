/**
 * Version history: append-only, diff-based, restorable.
 *
 * Model: version 1 is a FULL snapshot; each later version stores only the
 * top-level fields that changed (a delta). The state at version N is rebuilt
 * by replaying rows 1..N. Retention pruning never breaks the chain: pruned
 * prefix rows are folded into the oldest surviving row, which is promoted to
 * a full snapshot (compaction) before the prefix is deleted.
 */

import { applyDelta, cloneJson, diffSnapshots, isEmptyDiff, sanitizeSnapshot } from './diff';
import { LifecycleError } from './errors';
import type {
  DiffOptions,
  EntityRef,
  RetentionPolicy,
  Snapshot,
  VersionKind,
  VersionRecord,
  VersionStore,
} from './types';

/** A history row decorated for display (what changed, by whom, when). */
export interface VersionSummary {
  version: number;
  kind: VersionKind;
  actorId: string | null;
  createdAt: Date;
  /** Top-level fields this version changed (empty for full snapshots). */
  changedFields: string[];
  /** Fields this version removed. */
  removedFields: string[];
  restoredFromVersion: number | null;
}

/**
 * Record the CREATE of an entity: version 1, full snapshot.
 * Returns the created row.
 */
export async function recordCreate(
  store: VersionStore,
  ref: EntityRef,
  snapshot: Snapshot,
  actorId: string | null,
  options?: DiffOptions,
): Promise<VersionRecord> {
  return store.append({
    ...ref,
    version: 1,
    kind: 'CREATE',
    isSnapshot: true,
    data: sanitizeSnapshot(snapshot, options),
    removedFields: [],
    actorId,
    restoredFromVersion: null,
  });
}

/**
 * Record an UPDATE (or RESTORE) as a delta against the previous state.
 * Returns the created row, or null when nothing changed (no empty versions).
 * When the entity has no history yet (adopted mid-life), a full snapshot is
 * recorded instead so the chain always starts from a materializable base.
 */
export async function recordChange(
  store: VersionStore,
  ref: EntityRef,
  input: {
    before: Snapshot;
    after: Snapshot;
    kind?: Extract<VersionKind, 'UPDATE' | 'RESTORE'>;
    actorId: string | null;
    restoredFromVersion?: number;
  },
  options?: DiffOptions,
): Promise<VersionRecord | null> {
  const latest = await store.latest(ref);
  if (!latest) {
    // No history yet: seed the chain with the AFTER state as the base.
    return store.append({
      ...ref,
      version: 1,
      kind: input.kind ?? 'UPDATE',
      isSnapshot: true,
      data: sanitizeSnapshot(input.after, options),
      removedFields: [],
      actorId: input.actorId,
      restoredFromVersion: input.restoredFromVersion ?? null,
    });
  }

  const diff = diffSnapshots(
    sanitizeSnapshot(input.before, options),
    sanitizeSnapshot(input.after, options),
    options,
  );
  if (isEmptyDiff(diff)) return null;

  return store.append({
    ...ref,
    version: latest.version + 1,
    kind: input.kind ?? 'UPDATE',
    isSnapshot: false,
    data: diff.changed,
    removedFields: diff.removed,
    actorId: input.actorId,
    restoredFromVersion: input.restoredFromVersion ?? null,
  });
}

/**
 * Rebuild the entity state as of `version` by replaying the chain from the
 * nearest full snapshot at-or-before it.
 */
export async function materializeVersion(
  store: VersionStore,
  ref: EntityRef,
  version: number,
): Promise<Snapshot> {
  const rows = await store.list(ref);
  const target = rows.filter((row) => row.version <= version);
  const last = target[target.length - 1];
  if (!last || last.version !== version) {
    throw new LifecycleError(
      'VERSION_NOT_FOUND',
      `Version ${version} not found for ${ref.entityType}/${ref.entityId}.`,
    );
  }

  // Start from the LATEST full snapshot at-or-before the target (v1 is always
  // one, so this always exists in a healthy chain).
  let baseIndex = -1;
  for (let i = target.length - 1; i >= 0; i -= 1) {
    const row = target[i];
    if (row && row.isSnapshot) {
      baseIndex = i;
      break;
    }
  }
  if (baseIndex < 0) {
    throw new LifecycleError(
      'INVALID_STATE',
      `Version chain for ${ref.entityType}/${ref.entityId} has no base snapshot.`,
    );
  }

  const base = target[baseIndex];
  let state: Snapshot = base ? cloneJson(base.data) : {};
  for (let i = baseIndex + 1; i < target.length; i += 1) {
    const row = target[i];
    if (row) state = applyDelta(state, row.data, row.removedFields);
  }
  return state;
}

/** Decorate history rows for a UI list (newest first). */
export async function listHistory(
  store: VersionStore,
  ref: EntityRef,
): Promise<VersionSummary[]> {
  const rows = await store.list(ref);
  return rows
    .map((row) => ({
      version: row.version,
      kind: row.kind,
      actorId: row.actorId,
      createdAt: row.createdAt,
      changedFields: row.isSnapshot ? [] : Object.keys(row.data),
      removedFields: [...row.removedFields],
      restoredFromVersion: row.restoredFromVersion,
    }))
    .reverse();
}

/**
 * Apply a retention policy: prune version rows that exceed `maxVersions` or
 * `maxAgeDays`, keeping at least `minKeep` (default 1) and ALWAYS keeping the
 * chain materializable — before deleting a prefix, the oldest surviving row
 * is compacted into a full snapshot.
 *
 * Returns the number of pruned rows.
 */
/**
 * How many PREFIX rows (oldest first) the policy marks for pruning. Both
 * criteria mark a prefix: history is only ever trimmed from the tail of the
 * past, never from the middle (the chain must stay replayable).
 */
function prunablePrefixCount(
  rows: readonly VersionRecord[],
  policy: RetentionPolicy,
  now: Date,
): number {
  let pruneCount = 0;
  if (policy.maxVersions !== undefined && rows.length > policy.maxVersions) {
    pruneCount = rows.length - policy.maxVersions;
  }
  if (policy.maxAgeDays !== undefined) {
    const cutoff = now.getTime() - policy.maxAgeDays * 24 * 60 * 60 * 1000;
    let aged = 0;
    for (const row of rows) {
      if (row.createdAt.getTime() < cutoff) aged += 1;
      else break;
    }
    pruneCount = Math.max(pruneCount, aged);
  }
  const minKeep = Math.max(policy.minKeep ?? 1, 1);
  return Math.min(pruneCount, rows.length - minKeep);
}

export async function applyRetention(
  store: VersionStore,
  ref: EntityRef,
  policy: RetentionPolicy,
  now: Date = new Date(),
): Promise<number> {
  const rows = await store.list(ref);
  if (rows.length === 0) return 0;

  const pruneCount = prunablePrefixCount(rows, policy, now);
  if (pruneCount <= 0) return 0;

  // Compact: fold the pruned prefix into the first surviving row.
  const survivor = rows[pruneCount];
  if (!survivor) return 0;
  if (!survivor.isSnapshot) {
    const state = await materializeVersion(store, ref, survivor.version);
    await store.promoteToSnapshot(ref, survivor.version, state);
  }
  await store.deleteVersions(
    ref,
    rows.slice(0, pruneCount).map((row) => row.version),
  );
  return pruneCount;
}
