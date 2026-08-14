/**
 * Audit-log retention — the ONLY sanctioned delete path for entries.
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
import { AuditConfigError } from '../core/errors';

import type { AuditDbProvider } from './db';
import { DEFAULT_RETENTION_FLOOR_DAYS, type AuditRetentionConfig } from './config';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TABLE = 'audit_logs';
/** A bare SQL identifier — nothing else may be interpolated into a statement. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The floor in force, refused at CONSTRUCTION unless it bounds something.
 *
 * `floorDays` is the sweep's cutoff, and every unusable value fails towards
 * deleting more rather than fewer:
 *
 *  - **`0`** puts the cutoff at `now`, so the first sweep deletes the entire
 *    trail — every tenant, every entry, including ones written seconds ago. It
 *    is not nonsense-looking either: it reads as "no retention", and "no
 *    retention" on a sweep that DELETES means "keep nothing".
 *  - **negative** puts the cutoff in the future, which is the same deletion
 *    with the reasoning inverted.
 *  - **`NaN`** is what `Number(process.env.AUDIT_RETENTION_DAYS)` yields for an
 *    unset variable, and `Infinity` what a division by a missing denominator
 *    yields; both reach `new Date(Date.now() - x)` and produce an Invalid Date
 *    the database refuses at sweep time, months after the wiring was written.
 *
 * `purgeExpired(days)` checks its own argument too — the same funnel, at the
 * other end: a host that computes a window per run never passes through here.
 */
function requireFloorDays(declared: number | undefined): number {
  const floorDays = declared ?? DEFAULT_RETENTION_FLOOR_DAYS;
  if (!Number.isFinite(floorDays) || floorDays <= 0) {
    throw new AuditConfigError(
      'retention.floorDays',
      `must be a positive, finite number of days; received ${String(floorDays)}. ` +
        'A window that bounds nothing makes the first sweep delete the whole trail, ' +
        'and there is nothing to undo it with.',
    );
  }
  return floorDays;
}

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
  const floorDays = requireFloorDays(config.floorDays);
  const table = config.table ?? DEFAULT_TABLE;
  if (!SAFE_IDENTIFIER.test(table)) {
    // Thrown at construction, not at sweep time: a host that mistyped the table
    // name should find out when it wires the surface, not months later when the
    // first sweep runs.
    throw new AuditConfigError(
      'retention.table',
      `"${table}" is not a bare SQL identifier. It is interpolated into the sweep ` +
        'statement as an identifier, never bound as a parameter.',
    );
  }

  return {
    floorDays,
    async purgeExpired(retentionDays: number = floorDays): Promise<number> {
      if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
        // The same refusal as the constructor's, at the other end of the same
        // funnel: a host that computes a window per run never passes a config
        // value at all. `0` is refused here too — it puts the cutoff at `now`,
        // which deletes the whole trail, and reads as "no retention" while
        // meaning "keep nothing". On an append-only table there is nothing to
        // undo either with.
        throw new AuditConfigError(
          'purgeExpired(retentionDays)',
          `must be a positive, finite number of days; received ${String(retentionDays)}.`,
        );
      }
      const client = await db();
      const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
      return client.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "created_at" < $1`,
        cutoff,
      );
    },
    async purgeTenantWindow(clientId: string, since: Date, cutoff: Date): Promise<number> {
      if (typeof clientId !== 'string' || clientId === '') {
        // A host contract violation, and the same one `store.ts` refuses: an
        // unscoped sweep would delete every tenant's rows inside the range.
        throw new Error(
          'purgeTenantWindow requires a tenant id: received ' +
            `${JSON.stringify(clientId)}. An unscoped sweep would cross tenants.`,
        );
      }
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
