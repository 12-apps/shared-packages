import type { JsonValue, Snapshot } from './types';

/**
 * The lifecycle wire vocabulary — the shapes that cross the network, named
 * ONCE.
 *
 * Every one of these is stated three times over: the server builds it, the
 * React client consumes it, and `./mcp` advertises it to agents. Three
 * statements of one shape is two chances to fall behind, and the failure is
 * quiet — an agent is told about a field the route stopped sending, or sent a
 * field it was never told about, and nothing reports either.
 *
 * `api.ts` said as much in prose before this file existed ("Paths here and in
 * `routes-*.ts` are ONE contract; changing either alone is a drift bug"). This
 * is that sentence made checkable: the server annotates its producers with
 * these types, and `mcp/schemas.ts` asserts its zod objects against them, so
 * the three agree by construction rather than by review.
 *
 * Type-only and dependency-free on purpose. `zod` and `@12-apps/mcp` are
 * OPTIONAL peers — a host that mounts no agent surface must not acquire them —
 * so the shared definition cannot live in `mcp/`, and the server cannot import
 * from `react/`. It lives here, where all three can reach it and none of them
 * pays for it at runtime.
 */

export interface VersionWire {
  version: number;
  kind: 'CREATE' | 'UPDATE' | 'RESTORE';
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
  changedFields: string[];
  removedFields: string[];
  restoredFromVersion: number | null;
}

/** What a compared version is to the selection (a version can play two). */
export type ComparisonRoleWire = 'previous' | 'selected' | 'next' | 'current';

/** One column of the comparison table: a version, and what it is to the selection. */
export interface ComparisonColumnWire {
  version: number;
  roles: ComparisonRoleWire[];
  kind: VersionWire['kind'];
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
}

/**
 * One field's value in one column. `present: false` means the version did not
 * carry the field at all — which the panel renders differently from a field
 * whose value IS null, because they are different answers.
 */
export interface ComparisonCellWire {
  version: number;
  present: boolean;
  value: JsonValue | null;
}

export interface ComparisonRowWire {
  field: string;
  changed: boolean;
  cells: ComparisonCellWire[];
}

export interface VersionComparisonWire {
  selectedVersion: number;
  columns: ComparisonColumnWire[];
  rows: ComparisonRowWire[];
}

export interface VersionsWire {
  versions: VersionWire[];
  publishedVersion: number;
  /** Present only when the request asked to compare a version (FUT-247). */
  comparison?: VersionComparisonWire | null;
}

/** The write outcome — `applied: false` means parked for approval (202). */
export interface WriteOutcomeWire {
  applied: boolean;
  entityId: string | null;
  requestId: string | null;
}

export interface DraftWire {
  id: string;
  entityId: string | null;
  data: Snapshot;
  status: 'OPEN' | 'PUBLISHED' | 'DISCARDED';
  updatedAt: string;
}
