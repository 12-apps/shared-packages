/**
 * The usage counters behind every quota feature — the app's `UsageCounter`
 * port, one branch per sellable ceiling, as a REGISTRY the engine can audit.
 *
 * ## Why a registry instead of a switch
 *
 * The engine never throws for a quota feature whose counter is missing — the
 * port exists, so its "no UsageCounter configured" guard cannot fire, and
 * `used` silently reads 0. `1 > limit` is false for every ceiling ≥ 1, so the
 * ceiling is simply never enforced, exactly on the tiers being sold. A
 * registry makes the gap DETECTABLE: `count` throws for a quota feature with
 * no entry, and `assertRegistered` refuses to even build the engine, so a
 * catalog declaring a quota key without a counter fails every test instead of
 * shipping a silently-unlimited tier.
 *
 * ## One source of truth for "what occupies a slot"
 *
 * Each counter is a function of `(db, tenantId, now)` where `db` may be a
 * TRANSACTION client. That one signature serves all three consumers:
 *
 *  - the engine's `usage.count`, for the friendly 402 with an upsell;
 *  - the serializable re-check inside a create transaction (quota-guard.ts),
 *    which is what actually enforces ceilings that must never be overrun;
 *  - any host-side grandfathering report, whose per-tenant path delegates
 *    here so the number an operator approved and the number the gate refuses
 *    on can never drift.
 *
 * The counters themselves are HOST config — only the host knows its tables.
 */

/** One counter: live usage of one quota feature for one tenant. */
export type UsageCounterFn<Db> = (db: Db, tenantId: string, now: Date) => Promise<number>;

export interface UsageRegistryConfig<Db> {
  /**
   * Every quota feature's counter, keyed by the canonical feature key. Keys
   * are plain strings on purpose: the counter for a ceiling lands here BEFORE
   * its feature key exists in the catalog — that ordering ("a quota without a
   * counter is worse than no quota") is the whole point — so this map cannot
   * be typed against the feature union without defeating it.
   */
  counters: Readonly<Record<string, UsageCounterFn<Db>>>;
  /**
   * Quota-KIND features whose ceiling is not a count of anything: the limit is
   * a number of DAYS, consumed by the retention sweep (retention.ts), never by
   * a create gate. Usage is constitutionally 0 — there is no "next unit" to
   * refuse — but they must still be registered, or declaring them would trip
   * the missing-counter guard that protects the real quotas.
   */
  retentionFeatures?: readonly string[];
  /** How a counter reaches the database outside a caller's transaction. */
  getDb: () => Promise<Db> | Db;
}

export interface UsageRegistry<Db> {
  /**
   * Live usage for one tenant and one quota feature — the engine's port.
   *
   * Throws for an unregistered quota feature. That turns the old failure mode
   * (ceiling silently unlimited, only symptom is revenue that never arrives)
   * into a loud one — though `assertRegistered` should make the throw
   * unreachable by refusing to build the engine at all.
   */
  count(tenantId: string, feature: string, db?: Db, now?: Date): Promise<number>;
  /**
   * Refuse to build an engine whose catalog declares a quota feature this
   * registry cannot count. Run once, at engine construction, so the failure is
   * every test and the first boot — never a customer's silently-unlimited
   * ceiling.
   */
  assertRegistered(quotaFeatures: readonly string[]): void;
  /** The engine's `UsageCounter` port over {@link count}. */
  port: { count(tenantId: string, feature: string): Promise<number> };
}

export function createUsageRegistry<Db>(config: UsageRegistryConfig<Db>): UsageRegistry<Db> {
  const retention = config.retentionFeatures ?? [];

  async function count(
    tenantId: string,
    feature: string,
    db?: Db,
    now: Date = new Date(),
  ): Promise<number> {
    if (retention.includes(feature)) return 0;
    const counter = config.counters[feature];
    if (!counter) {
      throw new Error(
        `Quota feature "${feature}" has no usage counter registered — its ceiling would ` +
          `silently never be enforced. Register a counter for it before granting the feature.`,
      );
    }
    return counter(db ?? (await config.getDb()), tenantId, now);
  }

  return {
    count,
    assertRegistered(quotaFeatures) {
      const missing = quotaFeatures.filter(
        (feature) => !config.counters[feature] && !retention.includes(feature),
      );
      if (missing.length > 0) {
        throw new Error(
          `Quota feature(s) declared without a usage counter: ${missing.join(', ')}. ` +
            `Register each counter before granting the feature.`,
        );
      }
    },
    port: {
      count: (tenantId, feature) => count(tenantId, feature),
    },
  };
}

/** Wall-clock minus instant, in ms, for `timeZone` at `instant`. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const field = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(field.year),
    Number(field.month) - 1,
    Number(field.day),
    // `hourCycle` quirks can render midnight as "24".
    Number(field.hour) % 24,
    Number(field.minute),
    Number(field.second),
  );
  return asUtc - instant.getTime();
}

/**
 * First instant of the tenant-local month containing `now` — the window for a
 * MONTHLY quota. "Month" means the tenant's month, not UTC's: an import booked
 * at 22h on the 30th in São Paulo is that month's usage, even though UTC
 * already says the next one.
 *
 * Plain `Intl` rather than a tz library: the two-pass offset correction makes
 * it DST-correct in any zone, and it keeps this package free of a runtime
 * dependency for one window computation. Usage resets by exclusion — last
 * month's rows fall out of the window, so nothing stored ever needs resetting.
 */
export function monthWindowStart(now: Date, timeZone: string): Date {
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).format(now);
  const [year, month] = local.split('-').map(Number) as [number, number];
  // Local midnight of the 1st is UTC midnight minus the zone offset; recompute
  // once with the corrected instant so a DST change at the boundary lands
  // right.
  const start = new Date(Date.UTC(year, month - 1, 1));
  const corrected = new Date(Date.UTC(year, month - 1, 1) - zoneOffsetMs(start, timeZone));
  return new Date(Date.UTC(year, month - 1, 1) - zoneOffsetMs(corrected, timeZone));
}
