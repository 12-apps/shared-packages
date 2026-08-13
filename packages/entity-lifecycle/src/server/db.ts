/**
 * The database seam (12-17) — the exact, narrow slice of a Prisma-shaped
 * client this surface reads and writes on the four models the package owns
 * (`prisma/entity-lifecycle.prisma`). Structural on purpose, never generated:
 * a real host passes its Prisma client; a harness passes hand-written SQL, and
 * the stores cannot tell.
 *
 * Every argument type below is CLOSED — the union of the shapes this package's
 * own stores actually pass — so a non-Prisma implementation has a finite,
 * documented surface to satisfy instead of "all of Prisma".
 *
 * Json columns cross the seam as `unknown` on the way OUT (rows) and as the
 * library's own JSON types on the way IN (create/update data); the stores cast
 * at the boundary exactly as the future-pay originals did.
 */

import type { Snapshot } from '../types';

// ---------------------------------------------------------------------------
// entity_versions
// ---------------------------------------------------------------------------

export interface EntityVersionRow {
  id: string;
  clientId: string;
  entityType: string;
  entityId: string;
  version: number;
  kind: string;
  isSnapshot: boolean;
  data: unknown;
  removedFields: unknown;
  actorId: string | null;
  restoredFrom: number | null;
  createdAt: Date;
}

export interface EntityVersionCreateData {
  clientId: string;
  entityType: string;
  entityId: string;
  version: number;
  kind: string;
  isSnapshot: boolean;
  data: Snapshot;
  removedFields: string[];
  actorId: string | null;
  restoredFrom: number | null;
}

/** The one per-entity filter every version read/write scopes by. */
export interface EntityVersionWhere {
  clientId: string;
  entityType: string;
  entityId: string;
  version?: number | { in: number[] };
}

export interface EntityVersionDelegate {
  create(args: { data: EntityVersionCreateData }): Promise<EntityVersionRow>;
  findMany(args: {
    where: EntityVersionWhere;
    orderBy: { version: 'asc' | 'desc' };
  }): Promise<EntityVersionRow[]>;
  findFirst(args: {
    where: EntityVersionWhere;
    orderBy: { version: 'asc' | 'desc' };
  }): Promise<EntityVersionRow | null>;
  deleteMany(args: { where: EntityVersionWhere }): Promise<{ count: number }>;
  updateMany(args: {
    where: EntityVersionWhere;
    data: { isSnapshot: boolean; data: Snapshot; removedFields: string[] };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// recycle_bin_entries
// ---------------------------------------------------------------------------

export interface RecycleBinRow {
  id: string;
  clientId: string;
  entityType: string;
  entityId: string;
  parentEntryId: string | null;
  label: string;
  snapshot: unknown;
  status: string;
  deletedBy: string | null;
  deletedAt: Date;
}

export interface RecycleBinCreateData {
  clientId: string;
  entityType: string;
  entityId: string;
  parentEntryId: string | null;
  label: string;
  snapshot: Snapshot;
  deletedBy: string | null;
}

export interface RecycleBinWhere {
  clientId: string;
  id?: string | { in: string[] };
  entityType?: string;
  status?: string;
  parentEntryId?: null | { in: string[] };
}

export interface RecycleBinDelegate {
  create(args: { data: RecycleBinCreateData }): Promise<RecycleBinRow>;
  findFirst(args: { where: RecycleBinWhere }): Promise<RecycleBinRow | null>;
  findMany(args: {
    where: RecycleBinWhere;
    orderBy: { deletedAt: 'asc' | 'desc' };
  }): Promise<RecycleBinRow[]>;
  updateMany(args: {
    where: RecycleBinWhere;
    data: { status: string };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// entity_drafts
// ---------------------------------------------------------------------------

export interface EntityDraftRow {
  id: string;
  clientId: string;
  entityType: string;
  entityId: string | null;
  data: unknown;
  status: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityDraftCreateData {
  clientId: string;
  entityType: string;
  entityId: string | null;
  data: Snapshot;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface EntityDraftWhere {
  clientId: string;
  id?: string;
  entityType?: string;
  entityId?: string;
  status?: string;
}

export interface EntityDraftDelegate {
  create(args: { data: EntityDraftCreateData }): Promise<EntityDraftRow>;
  update(args: {
    where: { id: string };
    data: { data: Snapshot; updatedBy: string | null };
  }): Promise<EntityDraftRow>;
  findFirst(args: { where: EntityDraftWhere }): Promise<EntityDraftRow | null>;
  findMany(args: {
    where: EntityDraftWhere;
    orderBy: { updatedAt: 'asc' | 'desc' };
  }): Promise<EntityDraftRow[]>;
  updateMany(args: {
    where: EntityDraftWhere;
    data: { status: string };
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// change_requests
// ---------------------------------------------------------------------------

export interface ChangeRequestRow {
  id: string;
  clientId: string;
  entityType: string;
  entityId: string | null;
  action: string;
  payload: unknown;
  status: string;
  requestedBy: string | null;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface ChangeRequestCreateData {
  clientId: string;
  entityType: string;
  entityId: string | null;
  action: string;
  payload: Snapshot;
  requestedBy: string | null;
}

export interface ChangeRequestWhere {
  clientId: string;
  id?: string;
  entityType?: string;
  entityId?: string;
  status?: string;
}

/** The decide write (CAS on PENDING) and the reopen compensation. */
export interface ChangeRequestUpdateData {
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface ChangeRequestDelegate {
  create(args: { data: ChangeRequestCreateData }): Promise<ChangeRequestRow>;
  findFirst(args: { where: ChangeRequestWhere }): Promise<ChangeRequestRow | null>;
  findMany(args: {
    where: ChangeRequestWhere;
    orderBy: { requestedAt: 'asc' | 'desc' };
  }): Promise<ChangeRequestRow[]>;
  updateMany(args: {
    where: ChangeRequestWhere;
    data: ChangeRequestUpdateData;
  }): Promise<{ count: number }>;
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

/** The model delegates — what both a live client and a transaction expose. */
export interface LifecycleDbClient {
  entityVersion: EntityVersionDelegate;
  recycleBinEntry: RecycleBinDelegate;
  entityDraft: EntityDraftDelegate;
  changeRequest: ChangeRequestDelegate;
}

/**
 * The full seam: delegates plus interactive transactions (the recycle-bin
 * tree insert is atomic). Prisma's own `$transaction(fn)` satisfies this
 * structurally — its transaction client carries the same delegates.
 */
export interface LifecycleDb extends LifecycleDbClient {
  $transaction<T>(fn: (tx: LifecycleDbClient) => Promise<T>): Promise<T>;
}

/** Deferred so hosts with an async client bootstrap can pass it directly. */
export type LifecycleDbProvider = () => Promise<LifecycleDb>;

/** Cast a Json column read back to the library's Snapshot shape. */
export const asSnapshot = (value: unknown): Snapshot => (value ?? {}) as Snapshot;

/** Cast a Json column holding a string array. */
export const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];
