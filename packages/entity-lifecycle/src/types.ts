/**
 * Shared contracts for the entity-lifecycle library. The core is storage- and
 * framework-agnostic: every persistence concern is an adapter interface the
 * host implements against its own database; the library ships only the
 * business rules, with zero runtime dependencies.
 */

/** JSON-compatible values — entity snapshots must be serializable. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/**
 * A point-in-time representation of an entity as a flat map of top-level
 * fields (values may be nested JSON). Diffing happens at TOP-LEVEL field
 * granularity — a version delta stores only the fields that changed.
 */
export type Snapshot = Record<string, JsonValue>;

/** The tenant-scoped identity of one entity instance. */
export interface EntityRef {
  tenantId: string;
  entityType: string;
  entityId: string;
}

/** The lifecycle features that can be feature-flagged per tenant. */
export type LifecycleFeature = 'versioning' | 'drafts' | 'approvals';

export const LIFECYCLE_FEATURES: readonly LifecycleFeature[] = [
  'versioning',
  'drafts',
  'approvals',
];

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

/** Why a version row was written. */
export type VersionKind = 'CREATE' | 'UPDATE' | 'RESTORE';

/**
 * One row of an entity's version history. Version 1 (and any compaction base)
 * is a FULL snapshot (`isSnapshot`); every other row is a DELTA — `data` holds
 * only the changed top-level fields (new values), `removedFields` the fields
 * that disappeared. State at N = replay rows 1..N (`materializeVersion`).
 */
export interface VersionRecord {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  /** 1-based, strictly increasing per entity. */
  version: number;
  kind: VersionKind;
  /** True when `data` is a full snapshot (v1 / compaction base). */
  isSnapshot: boolean;
  /** Full snapshot, or the changed fields' new values (delta). */
  data: Snapshot;
  /** Delta only: top-level fields removed relative to the previous version. */
  removedFields: readonly string[];
  /** Who made the change (host-defined user id); null for system writes. */
  actorId: string | null;
  createdAt: Date;
  /** For kind RESTORE: which version was restored. */
  restoredFromVersion: number | null;
}

/** Input to append one version row; the store assigns `id` + `createdAt`. */
export interface NewVersionRecord {
  tenantId: string;
  entityType: string;
  entityId: string;
  version: number;
  kind: VersionKind;
  isSnapshot: boolean;
  data: Snapshot;
  removedFields: readonly string[];
  actorId: string | null;
  restoredFromVersion: number | null;
}

/** Persistence adapter for version history. */
export interface VersionStore {
  append(record: NewVersionRecord): Promise<VersionRecord>;
  /** All rows for the entity, ascending by `version`. */
  list(ref: EntityRef): Promise<VersionRecord[]>;
  /** The highest version row, or null when the entity has no history. */
  latest(ref: EntityRef): Promise<VersionRecord | null>;
  /** Hard-delete the given version numbers (retention pruning). */
  deleteVersions(ref: EntityRef, versions: readonly number[]): Promise<void>;
  /**
   * Rewrite an existing row as a full snapshot (retention compaction folds the
   * pruned prefix into the oldest surviving row).
   */
  promoteToSnapshot(ref: EntityRef, version: number, data: Snapshot): Promise<void>;
}

/**
 * Auto-clean policy for version history. All criteria optional and combinable:
 * a version is pruned when it exceeds `maxVersions` (count) OR is older than
 * `maxAgeDays`. `minKeep` (default 1) always survives, so an entity never
 * loses its full history head.
 */
export interface RetentionPolicy {
  /** Keep at most this many versions per entity. */
  maxVersions?: number;
  /** Prune versions older than this many days. */
  maxAgeDays?: number;
  /** Never prune below this many versions (default 1). */
  minKeep?: number;
}

/** Options controlling how two snapshots are diffed. */
export interface DiffOptions {
  /** Top-level fields excluded from diffing (e.g. updatedAt). */
  ignoreFields?: readonly string[];
}

// ---------------------------------------------------------------------------
// Soft delete / recycle bin
// ---------------------------------------------------------------------------

export type RecycleBinStatus = 'DELETED' | 'RESTORED' | 'PURGED';

/**
 * One deleted entity in the recycle bin. Deleting an aggregate records a TREE:
 * the root entry plus one child entry per dependent record (variation child,
 * attached image, …), linked via `parentEntryId`, so the bin page can show
 * what a restore will bring back.
 */
export interface RecycleBinEntry {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  /** Null for a root entry; set for dependents deleted along with the root. */
  parentEntryId: string | null;
  /** Human label shown on the bin page ("Coca Cola 2L"). */
  label: string;
  /** Data needed to preview and restore the record. */
  snapshot: Snapshot;
  deletedBy: string | null;
  deletedAt: Date;
  status: RecycleBinStatus;
}

/** Input tree for recording a deletion; the store assigns ids + timestamps. */
export interface NewRecycleBinEntry {
  entityType: string;
  entityId: string;
  label: string;
  snapshot: Snapshot;
  children?: readonly NewRecycleBinEntry[];
}

export interface RecycleBinListFilter {
  entityType?: string;
  status?: RecycleBinStatus;
  /** When true (default) only root entries are returned. */
  rootsOnly?: boolean;
}

/** Persistence adapter for the recycle bin. */
export interface RecycleBinStore {
  /** Atomically insert a deletion tree; returns the created root entry. */
  addTree(
    tenantId: string,
    root: NewRecycleBinEntry,
    deletedBy: string | null,
  ): Promise<RecycleBinEntry>;
  list(tenantId: string, filter?: RecycleBinListFilter): Promise<RecycleBinEntry[]>;
  /** The entry plus all its descendants (root first). */
  getTree(tenantId: string, entryId: string): Promise<RecycleBinEntry[]>;
  setStatus(
    tenantId: string,
    entryIds: readonly string[],
    status: RecycleBinStatus,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export type DraftStatus = 'OPEN' | 'PUBLISHED' | 'DISCARDED';

/**
 * A per-item draft: unpublished edits kept next to the live record. A draft of
 * a NEW (not yet created) item has `entityId: null`. At most one OPEN draft
 * exists per (tenant, entityType, entityId).
 */
export interface DraftRecord {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string | null;
  data: Snapshot;
  status: DraftStatus;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Persistence adapter for drafts. */
export interface DraftStore {
  /** Create or update the single OPEN draft for the entity. */
  upsertOpen(input: {
    tenantId: string;
    entityType: string;
    entityId: string | null;
    data: Snapshot;
    actorId: string | null;
  }): Promise<DraftRecord>;
  get(tenantId: string, draftId: string): Promise<DraftRecord | null>;
  getOpenFor(
    tenantId: string,
    entityType: string,
    entityId: string,
  ): Promise<DraftRecord | null>;
  listOpen(tenantId: string, entityType?: string): Promise<DraftRecord[]>;
  setStatus(tenantId: string, draftId: string, status: DraftStatus): Promise<void>;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export type ChangeRequestAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

/**
 * A pending change awaiting approval. `payload` is the full desired snapshot
 * for CREATE/UPDATE (empty for DELETE). Applying an approved request is the
 * host's job (it owns the entity write), via the applier callback.
 */
export interface ChangeRequestRecord {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string | null;
  action: ChangeRequestAction;
  payload: Snapshot;
  status: ChangeRequestStatus;
  requestedBy: string | null;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
}

export interface ChangeRequestListFilter {
  entityType?: string;
  entityId?: string;
  status?: ChangeRequestStatus;
}

/** Persistence adapter for change requests. */
export interface ApprovalStore {
  create(input: {
    tenantId: string;
    entityType: string;
    entityId: string | null;
    action: ChangeRequestAction;
    payload: Snapshot;
    requestedBy: string | null;
  }): Promise<ChangeRequestRecord>;
  get(tenantId: string, requestId: string): Promise<ChangeRequestRecord | null>;
  list(
    tenantId: string,
    filter?: ChangeRequestListFilter,
  ): Promise<ChangeRequestRecord[]>;
  /**
   * COMPARE-AND-SET from PENDING to the decision (guard on the current
   * status: `UPDATE … WHERE status = 'PENDING'`). Returns whether THIS call
   * performed the transition — `false` = lost the race, do NOT apply.
   */
  decide(
    tenantId: string,
    requestId: string,
    decision: {
      status: Extract<ChangeRequestStatus, 'APPROVED' | 'REJECTED'>;
      decidedBy: string | null;
      decisionNote: string | null;
    },
  ): Promise<boolean>;
  /**
   * Compensation: put a claimed-but-unapplied request back to PENDING
   * (clearing the decision) when applying an APPROVED request fails.
   */
  reopen(tenantId: string, requestId: string): Promise<void>;
}

/** Outcome of a lifecycle write: applied now, or parked for approval. */
export type WriteResult =
  | { status: 'applied'; entityId: string }
  | { status: 'pending-approval'; requestId: string };

// ---------------------------------------------------------------------------
// Feature resolution + entity configuration
// ---------------------------------------------------------------------------

/**
 * Per-tenant feature state, resolved from three layers:
 *   1. code   — the collection opted into the feature (`EntityLifecycleConfig`)
 *   2. plan   — the tenant is ENTITLED to it (what they pay for)
 *   3. tenant — the tenant kept it ENABLED in their config panel (an entitled
 *               tenant may switch a feature off; they are never forced).
 */
export interface FeatureDecision {
  enabled: boolean;
  reason: 'enabled' | 'not-supported' | 'not-entitled' | 'disabled-by-tenant';
}

/** `true`/`false` per feature key; missing = fall back to the default. */
export type FeatureFlagMap = Partial<Record<LifecycleFeature, boolean>>;

/**
 * Static, code-level lifecycle configuration for ONE collection — the single
 * object a host writes to plug an entity in (see `createEntityLifecycle`).
 */
export interface EntityLifecycleConfig {
  /** Stable type key persisted on every record ("product"). */
  entityType: string;
  /** Which flaggable features this collection supports in code. */
  features: FeatureFlagMap;
  /**
   * Tenant-setting default per feature when the tenant is entitled but has
   * never touched the toggle. Unspecified features default to true (entitled
   * ⇒ on until explicitly disabled).
   */
  featureDefaults?: FeatureFlagMap;
  /** Human label for a snapshot, shown in history/recycle-bin UIs. */
  label: (snapshot: Snapshot) => string;
  /** Diff behaviour (ignored fields etc.). */
  diff?: DiffOptions;
  /** Version-history auto-clean policy. */
  retention?: RetentionPolicy;
}

/**
 * How the host performs actual entity writes. The lifecycle service funnels
 * every mutation through these five operations so versioning, recycle-bin,
 * drafts and approvals behave identically for every plugged-in collection.
 */
export interface EntityOps {
  /** Current live state, or null when the entity does not exist. */
  readSnapshot(tenantId: string, entityId: string): Promise<Snapshot | null>;
  /**
   * Create (`entityId` null) or update the live record from a snapshot.
   * Returns the entity id. Unknown/stale fields in a restored snapshot should
   * be ignored by the implementation (schema-drift tolerance).
   */
  applySnapshot(tenantId: string, entityId: string | null, snapshot: Snapshot): Promise<string>;
  /** Soft-hide the record (e.g. stamp archivedAt). False when not found. */
  archive(tenantId: string, entityId: string): Promise<boolean>;
  /** Undo `archive`. False when not found. */
  unarchive(tenantId: string, entityId: string): Promise<boolean>;
  /** Permanently delete the record (recycle-bin purge). */
  hardDelete(tenantId: string, entityId: string): Promise<void>;
  /**
   * Dependent records deleted along with the entity, for the recycle-bin tree
   * registry. Optional; defaults to none.
   */
  collectChildren?(tenantId: string, entityId: string): Promise<NewRecycleBinEntry[]>;
  /**
   * Called after a version row is recorded for the entity — the hook hosts use
   * to mirror a "published version" column onto the live record. Optional.
   */
  onVersionRecorded?(tenantId: string, entityId: string, version: number): Promise<void>;
}

/** Storage adapters bundle handed to `createEntityLifecycle`. */
export interface LifecycleStores {
  versions: VersionStore;
  recycleBin: RecycleBinStore;
  drafts?: DraftStore;
  approvals?: ApprovalStore;
}

/**
 * Per-request context: who acts, and the tenant's feature layers. The host
 * resolves `entitlements` (plan) and `settings` (config-panel toggles) once
 * per request and passes them in — the library never reads tenant state.
 */
export interface LifecycleContext {
  tenantId: string;
  actorId: string | null;
  /** Plan layer: what the tenant pays for. Missing feature = not entitled. */
  entitlements: FeatureFlagMap;
  /** Tenant layer: config-panel toggles. Missing = the feature's default. */
  settings: FeatureFlagMap;
  /**
   * Whether the actor may bypass/decide approvals (host checks RBAC, e.g.
   * "products:approve"). When approvals are active, writes by actors without
   * this become pending change requests.
   */
  canApprove?: boolean;
}
