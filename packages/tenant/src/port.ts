/**
 * The tenant port: the ONLY way the package reaches the host's tenant row.
 *
 * The tenant row, its slugs and its domains stay the host's. The package never
 * maps them (Prisma refuses two models on one table, and a shared partial has
 * no foreign key into a host table), so it asks the host through these five
 * functions instead. Every one is required.
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
}

/** The port's members, in a fixed order: what startup validation checks. */
export const TENANT_PORT_METHODS = [
  'bySlug',
  'byId',
  'setStatusIf',
  'clearProfile',
  'timeZone',
] as const satisfies readonly (keyof TenantPort)[];
