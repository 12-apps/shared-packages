/**
 * The purge engine's config and its answers (opt-in, built with
 * `createTenantPurge` on top of the lifecycle).
 *
 * The package names no table and no column of the host's: every table arrives
 * as the host ORM's MODEL name, read through `models.resolve` (Prisma's mapped
 * name), and every column the host's own. The tenant id is the only value the
 * engine binds itself (`$1`).
 */

/** A table named by the host ORM's MODEL; the engine reads its mapped name through `models.resolve`. */
export type TenantPurgeModel = string;

/** How a row names the tenant: a column holding its id, plus fixed discriminators (bound as parameters). */
export interface TenantPurgeKey {
  /** The mapped column: one of `keyColumns`. */
  column: string;
  /** Fixed column values every row of the tenant also carries (`{ kind: 'TENANT' }`). */
  equals?: Readonly<Record<string, string>>;
}

/** A row that names the tenant only through its parent (a report's lines). */
export interface TenantPurgeKeyThrough {
  through: {
    /** The parent's model. */
    model: TenantPurgeModel;
    /** The row's own column naming the parent. */
    column: string;
    /** The parent's column it names (its id). */
    references: string;
    /** How the parent names the tenant. */
    key: TenantPurgeKey;
  };
}

/** SQL fragments over the table's own columns: `$1` is the tenant id, `$2…` are `values()` in order. */
export interface TenantPurgeStrip {
  /** The `SET` list. */
  set: string;
  /** The rows the strip still changes (it keeps the statement idempotent and cheap). */
  when: string;
  /** Values bound as `$2…`, each read once per run. */
  values?: readonly (() => string)[];
}

/** A kept table whose rows name a row of the held table, which therefore stays. */
export interface TenantPurgeHolder {
  /** The kept table that names the row. */
  model: TenantPurgeModel;
  /** Its column naming the row. */
  column: string;
  /** The held table's column it names. Both tables share the held entry's key column. */
  matches: string;
}

/** A table whose rows hang off a held row and go when it is kept (its roles, say). */
export interface TenantPurgeHeldChild {
  model: TenantPurgeModel;
  /** Its column naming the held row. */
  column: string;
  /** The held table's column it names (its id). */
  references: string;
}

export interface TenantPurgeEraseEntry {
  model: TenantPurgeModel;
  key: TenantPurgeKey | TenantPurgeKeyThrough;
  action: 'erase';
}

export interface TenantPurgeKeepEntry {
  model: TenantPurgeModel;
  key: TenantPurgeKey | TenantPurgeKeyThrough;
  action: 'keep';
  /** The rule that keeps it (a law, the platform's own rule). */
  law: string;
}

/** A raw table with no model: only ever kept, never reached by SQL. */
export interface TenantPurgeKeepRawEntry {
  table: string;
  action: 'keep';
  law: string;
}

export interface TenantPurgeKeepAndStripEntry {
  model: TenantPurgeModel;
  key: TenantPurgeKey | TenantPurgeKeyThrough;
  action: 'keepAndStrip';
  law: string;
  strip: TenantPurgeStrip;
  /**
   * Absent: every row is kept and stripped, after the erase order. Present:
   * only the rows a holder names are kept (their children erased, the strip
   * applied), at this position of the order, and every other row is erased.
   */
  heldBy?: { holders: readonly TenantPurgeHolder[]; children: readonly TenantPurgeHeldChild[] };
}

/** Every table holding a tenant key, with ONE action. */
export type TenantPurgeEntry =
  | TenantPurgeEraseEntry
  | TenantPurgeKeepEntry
  | TenantPurgeKeepRawEntry
  | TenantPurgeKeepAndStripEntry;

/** How the owed objects reach storage: a seam, so a test can make storage fail. */
export interface TenantPurgeStorage {
  /** Delete the whole object set behind each key, scope-checked; never throws. */
  discard(scope: string, keys: readonly string[]): Promise<void>;
  /** Every object a key occupies: the key and its renditions. */
  members(key: string): readonly string[];
  /** Is the object there, gone, or could storage not say? */
  state(key: string): Promise<'present' | 'absent' | 'unknown'>;
}

/** The mirror's fields: what the engine wrote into `tenant_closings`, to write into the older table too. */
export interface TenantPurgeMirrorFields {
  purgedAt?: Date;
  imageKeysOwed?: readonly string[];
  imagesErasedAt?: Date;
}

/** A parsed object key, as the host's key grammar reads it (`@12-apps/storage`'s `parseObjectKey`). */
export interface TenantPurgeParsedKey {
  /** The tenant segment, or null for a legacy unscoped key. */
  scope: string | null;
}

export interface TenantPurgeConfig<Tx = unknown> {
  /** The key-column names a row may name the tenant by; every entry's key column is one of them. */
  keyColumns: readonly string[];
  /** Model → mapped table name (Prisma: `dbName ?? name`); null for a model it does not know. */
  models: { resolve(model: TenantPurgeModel): string | null };
  /** Every table holding a tenant key, ONE action each, in erase order. */
  tables: readonly TenantPurgeEntry[];
  db: {
    transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T>;
    /** One statement, autocommit when `tx` is absent; answers the rows it touched. */
    execute(sql: string, params: readonly unknown[], tx?: Tx): Promise<number>;
    /** One statement answering rows (a SELECT, or a write with RETURNING). */
    query<R>(sql: string, params: readonly unknown[], tx?: Tx): Promise<R[]>;
  };
  /** Revoke every way into the tenant (devices, tokens, connections), ON `tx`. Idempotent: a resumed run calls it again. */
  revokeCredentials(tx: Tx, tenantId: string): Promise<void>;
  /** Every object key the tenant's rows name, read before the erase (archived rows included). */
  collectImageKeys(tenantId: string): Promise<readonly string[]>;
  /** Of `keys` (legacy, unscoped), the ones another tenant still holds. ONE call per run, none when there is no such key. */
  heldElsewhere(tenantId: string, keys: readonly string[]): Promise<ReadonlySet<string>>;
  /** Run in order before the erase, outside any transaction; a throw stops the run, and the next pass resumes. */
  beforeErase: readonly ((tenantId: string, at: { now: Date }) => Promise<void>)[];
  /** Zero whatever the tenant still owes its people, ON `tx`. Called once per purge, by the run that stamped `purgedAt`. */
  zeroBalances(tx: Tx, tenantId: string): Promise<void>;
  /** REQUIRED until the host's contract release: write the same fields into its older closing table, on `tx`. */
  mirrorClosing(tx: Tx, tenantId: string, fields: TenantPurgeMirrorFields): Promise<void>;
  /** The host's storage, for the owed objects. */
  storage: TenantPurgeStorage;
  /** The host's key grammar: `(key) => parseObjectKey(key, prefix)`; null for a key it did not mint. */
  parseKey(key: string): TenantPurgeParsedKey | null;
  /** Whether a legacy key with no tenant segment may be the tenant's (`@12-apps/storage`'s `keyInScope`). */
  unscopedKeys: 'accept' | 'reject';
  /** Keys a pass deletes and checks at once. */
  imageChunk: number;
}

export type TenantPurgeOutcome = 'purged' | 'already' | 'notClosing' | 'notDue' | 'descendantsPending';

/** One step of the plan, as table names. */
export interface TenantPurgePlanStep {
  /** The mapped name. */
  table: string;
  /** `keepAndStrip` with `heldBy` is `keepHeld`, without it `strip`. */
  action: 'erase' | 'keepHeld' | 'strip' | 'keep';
  /** Absent on a raw kept table. */
  key?: TenantPurgeKey | TenantPurgeKeyThrough;
  /** `keepHeld`: the child tables emptied of the held rows. */
  children?: number;
}

export interface TenantPurge {
  /** Purge the tenant if it is closing and due, or closed with its purge stopped half way. */
  run(tenantId: string, at: { now: Date }): Promise<TenantPurgeOutcome>;
  /** One tenant's owed objects, after its purge; never throws; answers how many are still owed. */
  eraseOwedImages(tenantId: string, at: { now: Date; storage?: TenantPurgeStorage }): Promise<number>;
  /** Every purged tenant still owing objects, oldest purge first, `sweepBatch` of them. */
  sweepImages(now: Date): Promise<{ emptied: number }>;
  /** The config's tables in config order, as mapped names (the erase runs `erase`/`keepHeld` in order, then `strip`). */
  plan(): readonly TenantPurgePlanStep[];
}
