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

import type { AutoCloseResult } from './types';

export interface ShiftJobDeps {
  /**
   * Run one cross-tenant sweep. The host closes its service and its
   * per-tenant duration policy over this — the blueprint owns the cadence,
   * the lease and the reporting, never the vocabulary inside the call.
   */
  autoCloseOverdue(): Promise<AutoCloseResult>;
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
  },
} satisfies JobsContribution<ShiftJobDeps>;
