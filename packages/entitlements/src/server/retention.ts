/**
 * Retention quotas — quota-KIND features whose ceiling is a number of DAYS,
 * not a count of rows. No create gate ever reads them; they are consumed by a
 * host pruning sweep, which prunes what has aged past the tenant's window.
 *
 * ## "Downgrade never deletes", made mechanical
 *
 * A tenant who spent a year on a tier granting a 90-day window accumulated 90
 * days of audit history they were entitled to keep. Moving to a tier granting
 * 30 must not vaporize the other 60 the next time the sweep runs — that would
 * be the pruning-job version of a downgrade deleting data.
 *
 * ## A window of zero is not a window
 *
 * `retentionWindowDays` answers `null` — keep everything — for any ceiling
 * that is not a positive number. `prunableRange` mirrors it, and that symmetry
 * is the module's second invariant: read and write must agree about what a bad
 * window MEANS, or the read's fail-safe answer arrives at the write as an
 * instruction to delete everything.
 *
 * `0` is the sharp case. The cutoff would be `now`, every watermark's `since`
 * lies in the past, so `cutoff > since` passes and the range handed back is
 * the tenant's entire history. A negative window puts the cutoff in the
 * FUTURE, which is worse; `NaN` and `Infinity` answered `null` only by
 * accident of comparing an Invalid Date. And the check has to run before the
 * db access, because the watermark is written before the cutoff is computed —
 * so a bad window used to persist ITSELF, recorded as the tenant's current
 * window, even on the calls that returned nothing. The next sweep then found
 * a window that had not "changed", kept the stored `since`, and pruned from it.
 *
 * The host-side corollary: never write `retentionWindowDays(...) ?? 0`.
 *
 * The `RetentionWatermark` row (this package's own Prisma model — see
 * `prisma/entitlements.prisma`) makes the rule mechanical: it records when the
 * tenant's CURRENT window took effect (`since`), and a row is prunable only if
 * it was written AFTER that instant and has aged past the window. History from
 * before the window changed is simply never touched. Shortening retention
 * therefore stops NEW history from outliving the window; it does not
 * retroactively destroy what already exists. The same reset fires when a
 * window GROWS, where it merely under-prunes — the safe direction to be wrong
 * in.
 */
import type { EntitlementsEngine } from '../core/engine';
import type { FeatureRegistry } from '../core/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A watermark row as this module reads and writes it. */
export interface RetentionWatermarkRow {
  windowDays: number;
  since: Date;
}

/**
 * The slice of a Prisma-shaped client this module needs — duck-typed so the
 * host's generated client satisfies it without this package depending on
 * Prisma. The model itself ships with this package and is synced into the
 * host schema by `prisma:sync`.
 */
export interface RetentionWatermarkDb {
  retentionWatermark: {
    findUnique(args: {
      where: { clientId_feature: { clientId: string; feature: string } };
      select: { windowDays: true; since: true };
    }): Promise<RetentionWatermarkRow | null>;
    create(args: {
      data: { clientId: string; feature: string; windowDays: number; since: Date };
    }): Promise<unknown>;
    update(args: {
      where: { clientId_feature: { clientId: string; feature: string } };
      data: { windowDays: number; since: Date };
    }): Promise<unknown>;
  };
}

export interface RetentionConfig<F extends string> {
  engine: EntitlementsEngine<F>;
  features: FeatureRegistry<F>;
  /** The quota keys whose ceiling is a window of days (never a create gate). */
  retentionFeatures: readonly string[];
  getDb: () => Promise<RetentionWatermarkDb> | RetentionWatermarkDb;
}

export interface Retention {
  /**
   * The tenant's retention window for one feature, in days — or `null` when
   * nothing may be pruned.
   *
   * `null` is the FAIL-SAFE answer, returned whenever pruning could be wrong:
   * the feature key is not declared in this build, the grant is `unlimited`,
   * or the tenant is not entitled at all. That last one matters: "no
   * entitlement" must read as "keep everything", not "retention zero" — a
   * resolver hiccup deleting a tenant's history is the one failure this
   * module must never have.
   */
  retentionWindowDays(tenantId: string, feature: string): Promise<number | null>;
  /**
   * The prunable range for one tenant and feature: `[since, cutoff)`, where
   * `since` is when the current window took effect and `cutoff` is `now`
   * minus the window. Returns `null` while the range is empty — for the first
   * `windowDays` after a window change nothing has both been written under
   * the current window AND aged past it.
   *
   * Also `null`, and without touching the watermark, when `windowDays` is not
   * a positive finite number. That is the same answer `retentionWindowDays`
   * gives for such a ceiling, and the reason a host must never write
   * `retentionWindowDays(...) ?? 0`: `0` is a full-history purge, not "prune
   * nothing".
   *
   * Reads AND advances the watermark: a changed window (either direction)
   * resets `since` to now.
   */
  prunableRange(
    tenantId: string,
    feature: string,
    windowDays: number,
    now: Date,
  ): Promise<{ since: Date; cutoff: Date } | null>;
}

export function createRetention<F extends string>(config: RetentionConfig<F>): Retention {
  const { engine, features, retentionFeatures } = config;
  // An empty list is refused rather than read as "prune nothing": every call
  // would throw, so a sweep wired against it fails on its first tenant — but
  // only in whatever environment runs the sweep, which may be none of them
  // until production.
  if (retentionFeatures.length === 0) {
    throw new Error(
      'createRetention: `retentionFeatures` is empty. Name the quota keys whose ceiling ' +
        'is a window of days, or do not build a retention sweep.',
    );
  }

  return {
    async retentionWindowDays(tenantId, feature) {
      if (!retentionFeatures.includes(feature)) {
        throw new Error(`"${feature}" is not a retention quota — nothing should prune by it.`);
      }
      // `has` is a type guard, so past this line the string IS a feature key.
      if (!features.has(feature)) return null;
      const decision = await engine.check(tenantId, feature);
      if (!decision.enabled) return null;
      if (typeof decision.limit !== 'number' || decision.limit <= 0) return null;
      return decision.limit;
    },

    async prunableRange(tenantId, feature, windowDays, now) {
      // Gate 1, mirroring the read: the key must be a declared retention
      // quota. A throw, because pruning by a count of rows is a programming
      // error rather than a runtime condition.
      if (!retentionFeatures.includes(feature)) {
        throw new Error(`"${feature}" is not a retention quota — nothing should prune by it.`);
      }
      // Gate 2, mirroring the read's non-positive-limit branch: `null`, and
      // BEFORE any db access, so a bad window cannot persist itself as the
      // tenant's current one. See the header — `0` here is a full purge.
      if (!Number.isFinite(windowDays) || windowDays <= 0) return null;
      // The read's other two gates (`features.has`, the entitlement lookup)
      // are deliberately NOT mirrored: the caller already applied both to get
      // this window, and re-resolving costs an engine round-trip per tenant.
      const db = await config.getDb();
      const key = { clientId: tenantId, feature };
      const existing = await db.retentionWatermark.findUnique({
        where: { clientId_feature: key },
        select: { windowDays: true, since: true },
      });

      let since: Date;
      if (!existing) {
        // First observation. Everything already written predates enforcement —
        // the tenant accumulated it while effectively unlimited — so the
        // backlog is protected and the window starts counting from today.
        since = now;
        await db.retentionWatermark.create({ data: { ...key, windowDays, since } });
      } else if (existing.windowDays !== windowDays) {
        since = now;
        await db.retentionWatermark.update({
          where: { clientId_feature: key },
          data: { windowDays, since },
        });
      } else {
        since = existing.since;
      }

      const cutoff = new Date(now.getTime() - windowDays * DAY_MS);
      return cutoff > since ? { since, cutoff } : null;
    },
  };
}
