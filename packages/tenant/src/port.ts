/**
 * The tenant port: the ONLY way the package reaches the host's tenant row.
 *
 * The tenant row, its slugs and its domains stay the host's. The package never
 * maps them (Prisma refuses two models on one table, and a shared partial has
 * no foreign key into a host table), so it asks the host through these nine
 * functions instead. Every one is required, the tree's four included.
 */

/** What the package needs to know about one tenant. */
export interface TenantRecord<S extends string = string> {
  /** The host's tenant id, opaque to the package. */
  id: string;
  /** The slug the tenant is addressed by. */
  slug: string;
  /** The tenant row's current status: any value of the host's status set. */
  status: S;
}

/**
 * One tenant's place in the tenant tree, as the host stores it.
 *
 * The tree is ownership only (a company above its units, a unit above its
 * venues), of any depth. `path` is the materialized path the package computes
 * (`/<root id>/…/<own id>/`), so no tree read recurses.
 */
export interface TenantTreeNode {
  /** The host's tenant id. */
  id: string;
  /** The tenant directly above, or null for a standalone tenant (a root). */
  parentId: string | null;
  /** `/<root id>/…/<own id>/`; a root's is `/<own id>/`. */
  path: string;
}

/**
 * A subtree move, planned and validated by the package. The host applies it
 * as ONE statement: every path starting with `fromPath` has that prefix
 * replaced by `toPath`, and the row `id` is re-pointed at `parentId`.
 */
export interface TenantTreeMove {
  /** The tenant that moves, everything below it moving with it. */
  id: string;
  /** Its new parent, or null to make it a root. */
  parentId: string | null;
  /**
   * The new parent's path as the package read it (null with no parent). The
   * host applies the move only while the parent's path still is this.
   */
  parentPath: string | null;
  /** The moving tenant's path before the move: the prefix replaced. */
  fromPath: string;
  /** Its path after the move: the replacement prefix. */
  toPath: string;
}

/**
 * `Tx` is the host's transaction client. The package never opens one itself:
 * it hands back whatever the host gave it, so the host's own writes and the
 * package's land in the same transaction.
 */
export interface TenantPort<S extends string = string, Tx = unknown> {
  /** The tenant a slug names, or null when none does. */
  bySlug(slug: string): Promise<TenantRecord<S> | null>;
  /** The tenant with this id, or null when none exists. */
  byId(id: string): Promise<TenantRecord<S> | null>;
  /**
   * Compare-and-set the tenant's status: move it to `to` ONLY while it is
   * still `from`. Resolves true when the row moved, false when it was not in
   * `from` (another request got there first). The package relies on that
   * answer to make every lifecycle step happen once.
   */
  setStatusIf(id: string, from: S, to: S): Promise<boolean>;
  /**
   * Erase the tenant row's own profile (name, contact, address, whatever the
   * host keeps on it) inside the purge's transaction. The row itself stays.
   */
  clearProfile(tx: Tx, id: string): Promise<void>;
  /** The tenant's IANA time zone (`America/Sao_Paulo`): reminders and purge dates are computed in it. */
  timeZone(id: string): Promise<string>;
  /** The tree: one tenant's node, ONE read. Null when none exists. */
  treeNode(id: string): Promise<TenantTreeNode | null>;
  /**
   * The tree: the tenant and every tenant above it, in ONE read (the ids are
   * the segments of its own path). Any order; empty when the tenant is unknown.
   */
  treeAncestors(id: string): Promise<TenantTreeNode[]>;
  /**
   * The tree: the tenant and every tenant below it at any depth, in ONE
   * indexed prefix read on the path. Any order; empty when the tenant is unknown.
   */
  treeDescendants(id: string): Promise<TenantTreeNode[]>;
  /**
   * The tree: apply a planned move in ONE statement and answer the rows
   * written. 0 means the tree changed since the plan (the subtree is no longer
   * at `fromPath`, or the parent no longer at `parentPath`): nothing written.
   */
  moveSubtree(move: TenantTreeMove): Promise<number>;
}

/** The port's members, in a fixed order: what startup validation checks. */
export const TENANT_PORT_METHODS = [
  'bySlug',
  'byId',
  'setStatusIf',
  'clearProfile',
  'timeZone',
  'treeNode',
  'treeAncestors',
  'treeDescendants',
  'moveSubtree',
] as const satisfies readonly (keyof TenantPort)[];
