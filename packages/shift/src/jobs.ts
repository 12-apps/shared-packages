/**
 * `@12-apps/shift/jobs` — the package's job blueprints, deps left open.
 *
 * The origin host runs the auto-close sweep today as HOST code: its own
 * `defineJob` with the cadence, its own `withSweepLease` wrapper with the
 * ttl, its own logging. Every one of those numbers is a claim about THIS
 * package's domain — how often overdue shifts should be swept, how long one
 * sweep may hold the single-flight name — so they belong here, declared
 * once, and the host binds only what is genuinely its own: the service
 * instance and the per-tenant duration policy, closed over into one dep.
 *
 * This is the first blueprint to carry the wiring 1.3.0 `lease` field: the
 * declaration replaces the hand-rolled `withSweepLease(…, 30 min, …)` call,
 * and a host runner that cannot hold leases should decline the jobs binding
 * rather than run the sweep unfenced.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the value is a plain `satisfies`-checked object, inert until a host binds
 * it — declaring it registers nothing and starts nothing.
 */

import type { JobsContribution } from '@12-apps/wiring';

import type { ExtendSeriesResult } from './schedule-series-types';
import type { AutoCloseResult } from './types';

export interface ShiftJobDeps {
  /**
   * Run one cross-tenant sweep. The host closes its service and its
   * per-tenant duration policy over this — the blueprint owns the cadence,
   * the lease and the reporting, never the vocabulary inside the call.
   */
  autoCloseOverdue(): Promise<AutoCloseResult>;
  /**
   * Build the next days of every open series rule, in every tenant, up to the
   * horizon — the host closes its schedule service over this
   * (`schedule.extendSeries()`).
   */
  extendSeries(): Promise<ExtendSeriesResult>;
  /**
   * Told, per tenant, which rows the extension just built, so the host can
   * reconcile what it keeps beside the schedule. Called once per tenant that
   * got rows; a throw is logged and does not stop the other tenants.
   */
  onMaterialised(clientId: string, slotIds: readonly string[]): Promise<void>;
}

/** The built rows, one list per tenant. */
function builtByTenant(result: ExtendSeriesResult): Map<string, string[]> {
  const byTenant = new Map<string, string[]>();
  for (const entry of result.built) {
    byTenant.set(entry.clientId, [...(byTenant.get(entry.clientId) ?? []), ...entry.slotIds]);
  }
  return byTenant;
}

export const SHIFT_JOBS = {
  namespace: 'shift',
  blueprints: {
    autoClose: {
      name: 'auto-close',
      /** Overdue is measured in hours; every 15 minutes bounds the drift. */
      schedule: { pattern: '*/15 * * * *' },
      /** One sweep may hold the single-flight name for up to 30 minutes. */
      lease: { ttlMs: 30 * 60 * 1000 },
      /** A missed sweep is retried by the next tick, not by the queue. */
      attempts: 1,
      async handle(_payload, deps, context) {
        const result = await deps.autoCloseOverdue();
        if (result.closed.length > 0 || result.failures.length > 0) {
          context.logger.info(
            `shift auto-close swept: ${result.closed.length} closed, ${result.failures.length} failed`,
          );
        }
        for (const failure of result.failures) {
          context.logger.error(
            `shift auto-close failed for shift ${failure.shiftId} (tenant ${failure.clientId}): ${failure.code} ${failure.message}`,
          );
        }
      },
    },
    extendSeries: {
      name: 'extend-series',
      /** Daily: the horizon is weeks long, so one run a day keeps it whole. */
      schedule: { pattern: '17 4 * * *' },
      /** One run may hold the single-flight name for up to an hour. */
      lease: { ttlMs: 60 * 60 * 1000 },
      /** Idempotent, so a missed run is simply caught up by the next one. */
      attempts: 1,
      async handle(_payload, deps, context) {
        const result = await deps.extendSeries();
        const byTenant = builtByTenant(result);
        if (byTenant.size > 0 || result.skipped.length > 0) {
          const built = [...byTenant.values()].reduce((sum, ids) => sum + ids.length, 0);
          context.logger.info(`shift extend-series: ${built} built, ${result.skipped.length} days skipped`);
        }
        for (const failure of result.failures) {
          context.logger.error(
            `shift extend-series failed for series ${failure.seriesId} (tenant ${failure.clientId}): ${failure.message}`,
          );
        }
        for (const [clientId, slotIds] of byTenant) {
          try {
            await deps.onMaterialised(clientId, slotIds);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            context.logger.error(`shift extend-series: the host's reconcile failed for tenant ${clientId}: ${message}`);
          }
        }
      },
    },
  },
} satisfies JobsContribution<ShiftJobDeps>;
