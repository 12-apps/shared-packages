/**
 * Version COMPARISON — one version of an entity read side by side with its
 * neighbours (FUT-247).
 *
 * The history list answers "which fields did this version touch"; it cannot
 * answer "what did they say before, and what do they say now", because a
 * version row stores only the CHANGED fields' new values. Answering that means
 * materializing several versions and lining their fields up in one table.
 *
 * Four versions are lined up, by ROLE rather than by number:
 *
 *   previous → the version recorded before the selected one
 *   selected → the row the admin clicked
 *   next     → the version recorded after it
 *   current  → what the record says today
 *
 * Roles, not `i-1`/`i+1` arithmetic, because version NUMBERS are not dense:
 * retention pruning deletes a prefix (`applyRetention`), so v7's neighbour may
 * be v4. "Previous" means the previous surviving row, which is what an admin
 * reading the list means by it.
 *
 * A version can play more than one role — the newest version is both `next`
 * and `current`; the only version of a brand-new record is both `selected` and
 * `current` — so a role set is collected PER VERSION and each version appears
 * as exactly one column. Columns are ordered oldest-first, which is the order
 * the roles read in.
 */

import { jsonEquals } from './diff';
import { LifecycleError } from './errors';
import type {
  EntityRef,
  JsonValue,
  Snapshot,
  VersionKind,
  VersionRecord,
  VersionStore,
} from './types';
import { materializeFromRows } from './versioning';

/** What a column is to the version the admin selected. */
export type ComparisonRole = 'previous' | 'selected' | 'next' | 'current';

/** One column of the comparison: a version, and what it is to the selection. */
export interface ComparisonColumn {
  version: number;
  /** Every role this version plays, in role order (`['next', 'current']`). */
  roles: ComparisonRole[];
  kind: VersionKind;
  actorId: string | null;
  createdAt: Date;
}

/**
 * One field's value in one column. `present` is NOT `value !== null`: a field
 * explicitly set to null and a field the version does not carry at all are
 * different answers, and only the second one means "this version had no such
 * field" (it was added later, or removed by a delta).
 */
export interface ComparisonCell {
  version: number;
  present: boolean;
  value: JsonValue | null;
}

/** One row of the comparison table: a field, across every column. */
export interface ComparisonRow {
  field: string;
  /** One cell per column, in column order. */
  cells: ComparisonCell[];
  /** True when the columns do NOT all agree — the rows a reader came for. */
  changed: boolean;
}

/**
 * The comparison as a table: columns (versions) × rows (fields).
 *
 * EVERY field of every compared version is returned, `changed` or not. The
 * caller decides what to show — the panel leads with the differences — but the
 * capability stays complete, so a host that wants the whole record side by
 * side does not need a second endpoint to get it.
 */
export interface VersionComparison {
  selectedVersion: number;
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
}

export interface CompareOptions {
  /**
   * Which version counts as CURRENT — the host's published-version column,
   * when it mirrors one.
   *
   * A number that names no surviving row (0 for an archived record, or a
   * version since pruned) falls back to the newest recorded version, which is
   * the honest answer: version rows exist only for applied writes, so the last
   * one IS what the record says.
   */
  currentVersion?: number;
}

/** The version that plays `current`: the host's, or the newest recorded. */
function currentRow(
  rows: readonly VersionRecord[],
  currentVersion: number | undefined,
): VersionRecord | undefined {
  const named =
    currentVersion === undefined
      ? undefined
      : rows.find((row) => row.version === currentVersion);
  return named ?? rows[rows.length - 1];
}

/**
 * The columns around `index`, one per distinct version, oldest first.
 *
 * Roles are collected in a fixed order so a version playing two of them reads
 * the same way every time, and the de-duplication is what collapses "next" and
 * "current" into ONE column when the selection is the second-newest version.
 */
function columnsAround(
  rows: readonly VersionRecord[],
  index: number,
  currentVersion: number | undefined,
): ComparisonColumn[] {
  const picks: readonly (readonly [ComparisonRole, VersionRecord | undefined])[] = [
    ['previous', rows[index - 1]],
    ['selected', rows[index]],
    ['next', rows[index + 1]],
    ['current', currentRow(rows, currentVersion)],
  ];

  const byVersion = new Map<number, ComparisonColumn>();
  for (const [role, row] of picks) {
    if (!row) continue;
    const seen = byVersion.get(row.version);
    if (seen) {
      seen.roles.push(role);
      continue;
    }
    byVersion.set(row.version, {
      version: row.version,
      roles: [role],
      kind: row.kind,
      actorId: row.actorId,
      createdAt: row.createdAt,
    });
  }
  // Oldest first. Sorted rather than trusted from insertion order, because a
  // host that mirrors a STALE published version can put `current` before
  // `selected`, and a table whose columns run backwards is a worse answer than
  // one whose "current" column sits to the left.
  return [...byVersion.values()].sort((a, b) => a.version - b.version);
}

/** Two cells agree when both are absent, or both carry the same JSON. */
function cellsAgree(a: ComparisonCell, b: ComparisonCell): boolean {
  if (a.present !== b.present) return false;
  return !a.present || jsonEquals(a.value, b.value);
}

/** Every field any column carries, alphabetically, with its per-column cells. */
function fieldRows(
  columns: readonly ComparisonColumn[],
  states: ReadonlyMap<number, Snapshot>,
): ComparisonRow[] {
  const fields = new Set(
    columns.flatMap((column) => Object.keys(states.get(column.version) ?? {})),
  );

  return [...fields].sort().map((field) => {
    const cells = columns.map((column) => {
      const state = states.get(column.version) ?? {};
      const present = Object.hasOwn(state, field);
      return { version: column.version, present, value: present ? (state[field] ?? null) : null };
    });
    const [first, ...rest] = cells;
    return {
      field,
      cells,
      // One column agrees with itself: a lone version has nothing to differ
      // from, so nothing is `changed` and the panel says so rather than
      // painting every field as a difference.
      changed: first !== undefined && rest.some((cell) => !cellsAgree(first, cell)),
    };
  });
}

/**
 * Build the comparison table for `version`: it, its neighbours, and current.
 *
 * ONE read of the chain serves every column — the replay is pure, so four
 * materializations cost four passes over an array already in memory rather
 * than four round trips to the store.
 */
export async function compareVersions(
  store: VersionStore,
  ref: EntityRef,
  version: number,
  options: CompareOptions = {},
): Promise<VersionComparison> {
  const rows = await store.list(ref);
  const index = rows.findIndex((row) => row.version === version);
  if (index < 0) {
    throw new LifecycleError(
      'VERSION_NOT_FOUND',
      `Version ${version} not found for ${ref.entityType}/${ref.entityId}.`,
    );
  }

  const columns = columnsAround(rows, index, options.currentVersion);
  const states = new Map(
    columns.map((column) => [column.version, materializeFromRows(rows, column.version, ref)]),
  );
  return { selectedVersion: version, columns, rows: fieldRows(columns, states) };
}
