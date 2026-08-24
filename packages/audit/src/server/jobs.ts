/**
 * The retention sweep, declared — the schedule this package never shipped.
 *
 * ## Why it belongs here
 *
 * `createAuditRetention` has existed for as long as the append-only guard has:
 * the ONLY sanctioned delete path for entries, two bounded predicates that are
 * the whole security property of the trail. What the package never shipped was
 * the CADENCE. Every host had to notice the export, decide when to run it,
 * pick a queue, take a single-writer lease and thread the floor through.
 *
 * That is `paymentsJobBlueprints()`'s incident, one package over: a mechanism
 * a host must remember to schedule is a mechanism most hosts do not have — and
 * here the consequence is not a missing retry but `audit_logs` growing without
 * bound in every host that mounted the surface and never wired a sweep. The
 * origin host DID write it, correctly, in `lib/jobs/retention.ts`, restating
 * the queue, the concurrency, the lease and the pass structure that this file
 * now states once.
 *
 * ## What stays the host's, and why it is a dep rather than a field
 *
 * WHO decides a tenant's window is the host's business — it is usually a
 * billing question, and an entitlement resolver, a plan tier and a retention
 * watermark all live outside this package. `purgeTenantWindow` therefore takes
 * a RANGE rather than computing one, and the blueprint follows: `tenantWindows`
 * is an optional dep the host closes over, yielding the ranges it has already
 * decided. A host that has no tier windows omits it and gets the global floor
 * alone, which is the fail-safe direction — sweeping nothing extra beats
 * sweeping a window nobody authorised.
 *
 * The `since` bound travelling with each range is the "downgrade never
 * deletes" rule, and the reason this is a range and not a number of days:
 * entries written before the tenant's current window took effect were
 * accumulated under a longer entitlement, and a downgrade must not
 * retroactively destroy them.
 *
 * ## The cadence, and the one thing a host may still want to override
 *
 * Nightly at 04:30 UTC — a bounded delete pass belongs off-peak, and daily is
 * the resolution at which unbounded growth stops being a risk. `timezone` is
 * deliberately UNSET: a package cannot know a host's business hours, and UTC
 * is the honest default rather than a guess at one. A host that needs the pass
 * in its own local night declines the `jobs` capability in writing and keeps
 * its own schedule — which is exactly what a written decline is for.
 */

import type { JobsContribution, WireJobBlueprint } from '@12-apps/wiring';

import type { AuditRetention } from './retention';

/** One tenant's authorised prune range, as the host has already computed it. */
export interface AuditRetentionRange {
  clientId: string;
  /** The retention watermark — never delete before it. */
  since: Date;
  /** Everything older than this is out of the tenant's current window. */
  cutoff: Date;
}

/** What the host closes over when it binds the sweep. */
export interface AuditJobDeps {
  /**
   * The package's own delete path, as the two METHODS the sweep calls rather
   * than the whole object.
   *
   * A `Pick` of the real interface, so a reshape of either method stops
   * compiling here — and, more practically, so a host can DEFER. The retention
   * object usually comes off a mount that does not exist yet when the bindings
   * are written (`adoptServer` takes the bindings; the api comes out the other
   * side), so a host passes two arrows that reach for it when the sweep runs.
   * That is the same shape `NotificationsJobDeps` takes for the same reason.
   */
  retention: Pick<AuditRetention, 'purgeExpired' | 'purgeTenantWindow'>;
  /**
   * The per-tenant windows the host authorises this pass, or omitted for a
   * host with no tier windows at all. Called once per run; a host streaming
   * thousands of tenants returns them in whatever batches its plan resolver
   * already works in.
   */
  tenantWindows?: (now: Date) => Promise<readonly AuditRetentionRange[]>;
  /** Overridable clock, for a suite that drives the window deterministically. */
  now?: () => Date;
}

/** The single-flight queue — the same string `@12-apps/jobs` exports as `SWEEP_QUEUE`. */
export const AUDIT_SWEEP_QUEUE = 'sweeps';

/** Nightly, off-peak. See the header on why there is no timezone. */
export const AUDIT_RETENTION_CRON = '30 4 * * *';

/**
 * Generous: the pass is one global delete plus a bounded per-tenant delete
 * each, and a host with many tenants should not have the lease expire under a
 * run that is still making progress.
 */
export const AUDIT_RETENTION_LEASE_MS = 30 * 60_000;

const purgeExpired: WireJobBlueprint<void, AuditJobDeps> = {
  name: 'retention',
  queue: AUDIT_SWEEP_QUEUE,
  // Two passes deleting from the same table would race each other's cutoffs
  // and double the work for no gain; the pass is idempotent, so the next tick
  // is the only recovery this needs.
  concurrency: 1,
  schedule: { pattern: AUDIT_RETENTION_CRON },
  attempts: 1,
  lease: { ttlMs: AUDIT_RETENTION_LEASE_MS },
  handle: async (_payload, deps, context) => {
    const now = (deps.now ?? (() => new Date()))();
    const floorRows = await deps.retention.purgeExpired();

    let tenantRows = 0;
    const ranges = (await deps.tenantWindows?.(now)) ?? [];
    for (const range of ranges) {
      tenantRows += await deps.retention.purgeTenantWindow(
        range.clientId,
        range.since,
        range.cutoff,
      );
    }

    if (floorRows > 0 || tenantRows > 0) {
      // The floor's LENGTH is not named here: the sweep no longer holds the
      // whole retention object, and a number the host configured is a number
      // the host can already read. What the line has to carry is what this
      // pass DID, which is the part nothing else records.
      context.logger.info(
        `audit.retention removed ${floorRows} entry(ies) past the global floor ` +
          `and ${tenantRows} inside ${ranges.length} tenant window(s)`,
      );
    }
  },
};

/**
 * The jobs contribution. `namespace` is prepended once at bind time, so this
 * reaches a runner as `audit.retention`.
 */
export const AUDIT_JOBS = {
  namespace: 'audit',
  blueprints: { retention: purgeExpired },
} as const satisfies JobsContribution<AuditJobDeps>;
