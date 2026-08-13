/**
 * Audit-log retention (12-14) — the ONLY sanctioned delete path for entries.
 *
 * The model API blocks update/delete (the append-only guard), so the sweep goes
 * through raw SQL on purpose. Both functions are idempotent and safe to run at
 * any time; each is bounded by its own cutoff and NOTHING here can delete an
 * unbounded set — the two predicates are the whole security property, so they are
 * written once and tested against a real Postgres in the harness.
 *
 * WHO decides the window is the host's business (it is usually a billing
 * question), which is why {@link AuditRetention.purgeTenantWindow} takes the
 * range rather than computing it: an entitlement resolver, a plan tier and a
 * watermark table all live outside this package.
 */
import type { AuditDbProvider } from './db';
import type { AuditRetentionConfig } from './config';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FLOOR_DAYS = 365;
const DEFAULT_TABLE = 'audit_logs';
/** A bare SQL identifier — nothing else may be interpolated into a statement. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface AuditRetention {
  /** The floor in force, in days (what {@link purgeExpired} defaults to). */
  readonly floorDays: number;
  /**
   * Delete entries older than the retention floor, across every tenant. Returns
   * the number of rows removed.
   */
  purgeExpired(retentionDays?: number): Promise<number>;
  /**
   * Delete ONE tenant's entries inside `[since, cutoff)`.
   *
   * The lower bound is not an optimization, it is the "downgrade never deletes"
   * rule: `since` is the retention watermark — when the tenant's CURRENT window
   * took effect — and rows written before it were accumulated under a longer
   * entitlement, so the sweep must not touch them. A caller that wants "the last
   * N days" and passes `since = new Date(0)` gets exactly that, deliberately.
   */
  purgeTenantWindow(clientId: string, since: Date, cutoff: Date): Promise<number>;
}

export function createAuditRetention(
  db: AuditDbProvider,
  config: AuditRetentionConfig = {},
): AuditRetention {
  const floorDays = config.floorDays ?? DEFAULT_FLOOR_DAYS;
  const table = config.table ?? DEFAULT_TABLE;
  if (!SAFE_IDENTIFIER.test(table)) {
    // Thrown at construction, not at sweep time: a host that mistyped the table
    // name should find out when it wires the surface, not months later when the
    // first sweep runs.
    throw new Error(`Invalid audit table name "${table}" — expected a bare SQL identifier.`);
  }

  return {
    floorDays,
    async purgeExpired(retentionDays: number = floorDays): Promise<number> {
      if (!Number.isFinite(retentionDays) || retentionDays < 0) {
        // A negative window would put the cutoff in the FUTURE and delete
        // everything, including entries written seconds ago. Refuse rather than
        // sweep: on an append-only table there is nothing to undo it with.
        throw new Error(`Invalid retention window: ${retentionDays} days.`);
      }
      const client = await db();
      const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
      return client.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "created_at" < $1`,
        cutoff,
      );
    },
    async purgeTenantWindow(clientId: string, since: Date, cutoff: Date): Promise<number> {
      if (!clientId) throw new Error('purgeTenantWindow requires a tenant id.');
      // An inverted or empty range is a no-op rather than an error: a caller
      // computing `[watermark, now - window)` legitimately gets an empty range
      // for the first `window` days after the window changed, and making that
      // throw would push a "did I get a real range?" check into every caller.
      if (cutoff <= since) return 0;
      const client = await db();
      return client.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "client_id" = $1 AND "created_at" >= $2 AND "created_at" < $3`,
        clientId,
        since,
        cutoff,
      );
    },
  };
}
