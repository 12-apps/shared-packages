/**
 * Snapshot diffing at top-level field granularity.
 *
 * A version delta stores ONLY what changed: the new values of added/changed
 * top-level fields (`changed`) and the names of fields that disappeared
 * (`removed`). Values are compared by structural JSON equality, so a nested
 * array (e.g. a product's variations) counts as one changed field when any
 * part of it differs.
 */

import type { DiffOptions, JsonValue, Snapshot } from './types';

/** The result of diffing two snapshots. */
export interface SnapshotDiff {
  /** Added or changed fields → their NEW values. */
  changed: Snapshot;
  /** Fields present before but absent after. */
  removed: string[];
}

const arraysEqual = (a: readonly JsonValue[], b: readonly JsonValue[]): boolean =>
  a.length === b.length && a.every((item, i) => jsonEquals(item, b[i]));

const objectsEqual = (
  a: Record<string, JsonValue>,
  b: Record<string, JsonValue>,
): boolean => {
  const aKeys = Object.keys(a);
  return (
    aKeys.length === Object.keys(b).length &&
    aKeys.every((key) => jsonEquals(a[key], b[key]))
  );
};

/** Structural equality over JSON values (order-sensitive for arrays). */
export function jsonEquals(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  // Anything non-object (primitives, undefined, null) is only equal by identity.
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  return aIsArray
    ? arraysEqual(a as JsonValue[], b as JsonValue[])
    : objectsEqual(a as Record<string, JsonValue>, b as Record<string, JsonValue>);
}

/** Deep-clone a JSON value (snapshots are stored, never aliased). */
export function cloneJson<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}

/** Diff `before` → `after`; `ignoreFields` are excluded from both sides. */
export function diffSnapshots(
  before: Snapshot,
  after: Snapshot,
  options?: DiffOptions,
): SnapshotDiff {
  const ignored = new Set(options?.ignoreFields ?? []);
  const changed: Snapshot = {};
  const removed: string[] = [];

  for (const [key, value] of Object.entries(after)) {
    if (ignored.has(key)) continue;
    if (!jsonEquals(before[key], value)) changed[key] = cloneJson(value);
  }
  for (const key of Object.keys(before)) {
    if (ignored.has(key)) continue;
    if (!(key in after)) removed.push(key);
  }
  return { changed, removed };
}

/** True when a diff carries no changes at all. */
export function isEmptyDiff(diff: SnapshotDiff): boolean {
  return diff.removed.length === 0 && Object.keys(diff.changed).length === 0;
}

/** Apply a delta on top of a state (returns a new snapshot). */
export function applyDelta(
  state: Snapshot,
  changed: Snapshot,
  removed: readonly string[],
): Snapshot {
  const next: Snapshot = { ...state };
  for (const [key, value] of Object.entries(changed)) next[key] = cloneJson(value);
  for (const key of removed) delete next[key];
  return next;
}

/** Strip ignored fields from a snapshot before storing it. */
export function sanitizeSnapshot(snapshot: Snapshot, options?: DiffOptions): Snapshot {
  const ignored = options?.ignoreFields;
  if (!ignored || ignored.length === 0) return cloneJson(snapshot);
  const ignoredSet = new Set(ignored);
  const clean: Snapshot = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (!ignoredSet.has(key)) clean[key] = cloneJson(value);
  }
  return clean;
}
