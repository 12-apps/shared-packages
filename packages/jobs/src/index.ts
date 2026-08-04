/**
 * `@12-apps/jobs` — typed background jobs with retries, backoff and cron, behind
 * a swappable driver.
 *
 *     // where the domain lives
 *     export const dispatchNotification = defineJob<{ notificationId: string }>({
 *       name: "notifications.dispatch",
 *       attempts: 5,
 *       backoff: { type: "exponential", delayMs: 5_000 },
 *       handle: async ({ notificationId }) => dispatchDeliveries(notificationId),
 *     });
 *
 *     // at an emit site
 *     await dispatchNotification.enqueue({ notificationId }, { dedupeKey: notificationId });
 *
 *     // at process start
 *     configureJobs({ driver: createBullMqJobDriver({ redisUrl, logger }), logger });
 *     await startJobWorkers();   // consumers only
 *
 * The two rules that keep this safe are documented on `JobDefinition`:
 * payloads carry identifiers rather than state, and every handler is
 * idempotent because delivery is at-least-once.
 *
 * The BullMQ driver is deliberately NOT re-exported here — it is imported
 * from `@12-apps/jobs/bullmq`, so that pulling in `defineJob` at an emit site
 * never drags Redis into a bundle that only ever enqueues.
 */

export { defineJob, findJob, listJobs, clearJobs, DuplicateJobError } from "./core/registry";
export type { RegisteredJob } from "./core/registry";

export {
  configureJobs,
  enqueueJob,
  getJobDriver,
  getJobLogger,
  resetJobRuntime,
  startJobWorkers,
  stopJobs,
} from "./core/runtime";

export type {
  AnyJobDefinition,
  EnqueueOptions,
  EnqueueResult,
  EnqueueSkipReason,
  JobBackoff,
  JobContext,
  JobDefinition,
  JobDriver,
  JobHandler,
  JobLogger,
  JobSchedule,
} from "./core/types";

export { createInlineJobDriver } from "./drivers/inline";
export type { InlineJobDriver, InlineJobRun } from "./drivers/inline";

export { parseRedisUrl, InvalidRedisUrlError } from "./drivers/redis-url";
export type { RedisConnectionOptions } from "./drivers/redis-url";
