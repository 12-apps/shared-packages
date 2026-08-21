/**
 * `@12-apps/realtime/jobs` — the package's job blueprints, deps left open.
 *
 * ADOPTING.md has carried the outbox worker as a prose example for as long as
 * the outbox existed: a 10-second drain loop and a daily purge, restated by
 * every host that enabled the outbox and by none that could DECLARE it. Both
 * numbers are claims about THIS package's domain — how quickly a committed
 * row should reach the bus, how often published rows are swept — so they
 * belong here, declared once; the host binds only what is genuinely its own:
 * the outbox instance (built over its database) and its retention policy.
 *
 * The drain is the wiring contract's sub-minute case in the flesh: a 5-field
 * cron bottoms out at one minute, so the blueprint declares an `interval`,
 * and a host whose runtime cannot repeat sub-minute must DECLINE the jobs
 * binding rather than silently round the cadence up.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the value is a plain `satisfies`-checked object, inert until a host binds
 * it — declaring it registers nothing and starts nothing.
 */

import type { JobsContribution } from "@12-apps/wiring";

import type { OutboxDrainResult } from "./server/outbox-drain";

export interface RealtimeJobDeps {
  /**
   * The host's outbox, `createRealtimeOutbox({ db })` over its own rows.
   * Only the two operations the blueprints run — the host keeps the
   * instance, its driver and its logger.
   */
  outbox: {
    drain(): Promise<OutboxDrainResult>;
    purgePublished(olderThanMs: number): Promise<number>;
  };
  /**
   * How long a PUBLISHED row stays before the purge removes it — retention
   * is storage policy, so the number is the host's (ADOPTING.md's example
   * keeps a week).
   */
  purgeRetentionMs: number;
}

export const REALTIME_JOBS = {
  namespace: "realtime",
  blueprints: {
    outboxDrain: {
      name: "outbox-drain",
      /** How quickly a committed row reaches the bus; cron cannot say it. */
      interval: { everyMs: 10_000 },
      /** A missed pass is retried by the next tick, not by the queue. */
      attempts: 1,
      async handle(_payload, deps, context) {
        // `more` is false whenever a pass gave up (`aborted`), so this loop
        // cannot spin on a deployment-wide fault — ADOPTING.md's own loop,
        // declared instead of restated per host.
        let pass = await deps.outbox.drain();
        let published = pass.published;
        let failed = pass.failed;
        while (pass.more) {
          pass = await deps.outbox.drain();
          published += pass.published;
          failed += pass.failed;
        }
        // A quiet tick is not a log line — this fires every ten seconds.
        if (failed > 0) {
          context.logger.error(`realtime outbox drain: ${failed} failed, ${published} published`);
        }
      },
    },
    outboxPurge: {
      name: "outbox-purge",
      /** Published rows are audit debris after the retention, not data. */
      schedule: { pattern: "0 4 * * *" },
      attempts: 1,
      async handle(_payload, deps, context) {
        const purged = await deps.outbox.purgePublished(deps.purgeRetentionMs);
        if (purged > 0) {
          context.logger.info(`realtime outbox purge: ${purged} published row(s) removed`);
        }
      },
    },
  },
} satisfies JobsContribution<RealtimeJobDeps>;
