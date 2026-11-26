/**
 * The tenant port: the ONLY way the package reaches the host's tenant row.
 *
 * The tenant row, its slugs and its domains stay the host's. The package never
 * maps them (Prisma refuses two models on one table, and a shared partial has
 * no foreign key into a host table), so it asks the host through these five
 * functions instead. Every one is required.
 *
 * TRANSACTIONS. Every lifecycle step changes the tenant row and the package's
 * own rows together: a close flips the status, recounts the blockers (one
 * found rolls the flip back), replaces the closing row and writes the audit
 * line, all in ONE transaction the package opens through the host. So every
 * write takes the caller's transaction `tx` and must run on it, never on a
 * client of its own; `byId` takes it too, so a refusal reads the status the
 * transaction sees.
 */

/** What the package needs to know about one tenant. */
export interface TenantRecord<S extends string = string> {
  /** The host's tenant id, opaque to the package. */
  id: string;
  /** The tenant's CURRENT slug (never a former one the host keeps). */
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
  /**
   * The tenant whose CURRENT slug is `slug`, or null when none is. A former
   * slug the host still keeps for redirects does not resolve here: kept slugs
   * are the address slice's, through a port of their own.
   */
  bySlug(slug: string): Promise<TenantRecord<S> | null>;
  /**
   * The tenant with this id, or null when none exists. Read on `tx` when one
   * is given, so a step inside a transaction sees that transaction's row.
   */
  byId(id: string, tx?: Tx): Promise<TenantRecord<S> | null>;
  /**
   * Compare-and-set the tenant's status, ON `tx`: move it to `to` ONLY while
   * it is still `from` (`UPDATE … SET status = to WHERE id = id AND status =
   * from`). Resolves true when the row moved, false when it was not in `from`
   * (another request got there first). The package relies on that answer to
   * make every lifecycle step happen once, and on `tx` to roll the move back
   * when a later step of the same transaction refuses.
   */
  setStatusIf(id: string, from: S, to: S, tx: Tx): Promise<boolean>;
  /**
   * Erase the tenant row's own profile (name, contact, address, whatever the
   * host keeps on it) ON `tx`, inside the purge's transaction. The row itself
   * stays.
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
