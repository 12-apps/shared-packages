/**
 * `@12-apps/jobs` — typed background jobs with retries, backoff and cron,
 * behind a swappable driver.
 *
 *     // where the domain lives
 *     export const renderReport = defineJob<{ reportId: string }>({
 *       name: "reports.render",
 *       attempts: 5,
 *       backoff: { type: "exponential", delayMs: 5_000 },
 *       handle: async ({ reportId }) => renderAndStore(reportId),
 *     });
 *
 *     // at an emit site
 *     await renderReport.enqueue({ reportId }, { dedupeKey: reportId });
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
 *
 * The OPERATIONAL half — driver resolution with the inline zero-config
 * default, the worker switch, graceful drain and the health endpoint — is
 * `createApiJobs` in `@12-apps/jobs/server` (mount it with
 * `@12-apps/jobs/hono` or your own adapter). What this root adds to it:
 *
 *   - `DEFAULT_QUEUE` / `SWEEP_QUEUE` — this package's own queue vocabulary,
 *     `SWEEP_QUEUE` being the single-flight queue the scheduled sweeps share.
 *   - `createSweepLease` — the named, time-bounded claim that keeps a sweep
 *     to ONE pass per tick across a multi-worker deployment. Its `SweepLease`
 *     table ships in `prisma/jobs.prisma` with its migration; the host syncs
 *     both (see ADOPTING.md).
 *
 * Every guard this package has lives on THIS path as well as on the factory:
 * `defineJob` refuses a definition that cannot run, `startJobWorkers` refuses
 * an empty registry, and `enqueueJob` refuses a job the registry does not
 * hold. A host that wires the runtime by hand is not a host with fewer checks.
 */

export {
  defineJob,
  findJob,
  listJobs,
  clearJobs,
  resolveRegisteredJob,
  DuplicateJobError,
  InvalidJobDefinitionError,
  NoJobsRegisteredError,
} from "./core/registry";
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
  JobCompletedEvent,
  JobContext,
  JobDefinition,
  JobDriver,
  JobEvents,
  JobFailedEvent,
  JobHandler,
  JobLogger,
  JobRetention,
  JobRetentionWindow,
  JobRunEvent,
  JobSchedule,
  ScheduleRemovedEvent,
} from "./core/types";

// Retention validation lives in `core` so this barrel can carry it without
// pulling `bullmq` (and ioredis) into a bundle that only ever enqueues.
export { assertValidRetention, InvalidJobRetentionError } from "./core/retention";

export { createInlineJobDriver } from "./drivers/inline";
export type { InlineJobDriver, InlineJobRun } from "./drivers/inline";

export { parseRedisUrl, InvalidRedisUrlError } from "./drivers/redis-url";
export type { RedisConnectionOptions } from "./drivers/redis-url";

export { DEFAULT_QUEUE, SWEEP_QUEUE } from "./core/queues";

export { createSweepLease } from "./lease/sweep-lease";
export type {
  SweepLease,
  SweepLeaseConfig,
  SweepLeaseDb,
  SweepLeaseDbProvider,
  SweepLeaseDelegate,
  SweepLeaseOutcome,
  WithSweepLease,
} from "./lease/sweep-lease";
