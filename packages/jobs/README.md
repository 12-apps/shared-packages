# @12-apps/jobs

Typed background jobs — retries, exponential backoff and cron — behind a
swappable driver. BullMQ/Redis in production, inline execution in tests and
zero-config development.

Framework-free and domain-free: no ORM import, no host-app types, no job names
of its own. The logger is a port, the lease's database is a structural seam,
observation is a port, and the one web framework in sight (`hono`) is an
optional peer behind its own subpath.

```ts
// where the domain lives — the import IS the registration
export const renderReport = defineJob<{ reportId: string }>({
  name: "reports.render",
  attempts: 5,
  backoff: { type: "exponential", delayMs: 5_000 },
  handle: async ({ reportId }) => renderAndStore(reportId),
});

// a job that only ever runs on a schedule needs no binding at all
defineJob({
  name: "reports.purge",
  schedule: { pattern: "*/5 * * * *", timezone: "UTC" },
  handle: async () => purgeExpired(),
});

// at an emit site
await renderReport.enqueue({ reportId }, { dedupeKey: reportId });

// at process start — ONE call wires driver, workers, drain, lease and health
import { createApiJobs } from "@12-apps/jobs/server";
import { jobsRouter } from "@12-apps/jobs/hono";

const jobsApi = createApiJobs({
  jobs: () => import("./lib/jobs"),   // the defineJob modules — required
  db: () => getPrismaClient(),        // the sweep_leases table (optional)
  events: { onJobFailed: pageOnDeadLetter },   // yours, if you want one
});
await jobsApi.start();
app.route("/api/internal/jobs", jobsRouter(jobsApi));
```

With no `REDIS_URL` and no config, `start()` resolves the INLINE driver
outside production: handlers run in-process, schedules do not fire (and say
so), and the app starts green with no Redis container. Production with no
Redis resolves to NO driver plus a loud error and a 503 from `/health` —
never a crash, never a silent fake. `JOBS_WORKER=1` is what turns a process
from producer (enqueue only) into consumer (workers + schedules); the worker
is the same image, not a second build.

The full adoption contract — config seam, env variables, the events port, the
sweep lease, the Prisma partial and why there is no `createWebJobs` — is in
[ADOPTING.md](./ADOPTING.md).

## The two rules

**Payloads carry identifiers, never state.** `{ reportId }`, not the rendered
report. The database is the source of truth; the queue only decides *when*. A
payload that duplicates a row is a second copy that can disagree with it, and
it is the copy that gets acted on days later.

**Handlers are idempotent.** Delivery is at-least-once — a worker can die
between the side effect and the acknowledgement. Lean on the database's unique
constraints, not on the queue.

## What it refuses

Three wiring mistakes are refused rather than absorbed, because each of them
is otherwise **silent** — the process starts, the probe is green, and work
simply stops happening:

- **A job that cannot run.** `defineJob` throws on a blank name, an empty
  `queue` (which never falls back to the default — it creates a queue nobody
  consumes), a non-positive `attempts`/`concurrency`, a backoff with no delay,
  and a cron pattern that is not 5 or 6 fields. `"@daily"` and `""` both
  install a scheduler that never fires.
- **A deployment with no jobs.** `createApiJobs({ jobs: [] })` throws at the
  factory; a `jobs` thunk that registers nothing throws from `start()`; and
  `startJobWorkers()` throws on an empty registry, so the hand-wired root path
  is guarded identically. Declaring nothing is not a way to turn jobs off —
  `JOBS_DRIVER=off` is.
- **An enqueue no worker could ever claim.** `enqueue` returns
  `{ enqueued: false, reason: "unregistered" }` for a definition the registry
  does not hold under that name (identity, not just the name). The alternative
  is a write the backend accepts, no handler claims, and the consumer
  dead-letters — after the caller was told `enqueued: true`.
- **A `retention` window that bounds nothing.** Every number must be positive
  and finite. A negative `count` does not keep fewer jobs, it trims one per
  completion instead of holding a ceiling; `NaN` (an unset env var read through
  `Number()`) disables the comparison entirely. Refused at the factory and
  again in the driver.

## Guarantees and non-guarantees

- `enqueue` **never throws**. A queue outage returns `{ enqueued: false }` and
  logs; it does not fail the request that was deferring work.
- Bounded backend memory: completed jobs are kept a day, failed ones a week,
  and a host with a different support window passes its own `retention` — whose
  four numbers are validated, because a negative or `NaN` window stops bounding
  the backend rather than shrinking it.
- Schedules are **reconciled** on start — a cron job deleted from code has its
  scheduler removed from Redis, instead of firing forever at a handler that no
  longer exists. That removal is reported to `events.onScheduleRemoved`,
  because it is destructive and a deploy did it.
- The `inline` driver honours `attempts` but not delays or schedules, and both
  omissions are logged rather than silent. It is refused in production —
  by name, by env var and by instance.

The BullMQ driver is exported from `@12-apps/jobs/bullmq`, never the barrel, so
importing `defineJob` at an emit site does not drag Redis into the bundle.
`createApiJobs` keeps the same property: it imports the BullMQ driver lazily,
only in a process whose resolution actually picked it.

Redis must run with `maxmemory-policy noeviction` — the driver checks and
complains.

## Telling somebody else what happened

This package notifies nobody, audits nothing and publishes no events. What it
owns is the MOMENT, and the moments are a port:

```ts
createApiJobs({
  jobs: () => import("./lib/jobs"),
  events: {
    // The dead-letter. `terminal` is the whole point — a non-terminal failure
    // is ordinary retry noise.
    onJobFailed: ({ name, error, terminal }) => {
      if (terminal) void notifyOperators(name, error);
    },
    onJobCompleted: ({ name, runId }) => void publishRealtime(name, runId),
    // A deploy just cancelled a recurring job, permanently.
    onScheduleRemoved: ({ name, queue }) => void audit("schedule.removed", { name, queue }),
  },
});
```

An observer that throws or rejects is logged and swallowed: somebody else's
code must not be able to fail the job it is watching.

## The sweep lease

Scheduled sweeps declare `queue: SWEEP_QUEUE, concurrency: 1`, which makes
them single-flight within one worker. Across replicas that guarantee needs a
named, time-bounded claim in the DATABASE — `createSweepLease` (or the bound
`withSweepLease` on the `createApiJobs` return):

```ts
defineJob({
  name: "reports.purge",
  queue: SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: "0 * * * *" },
  handle: async () => {
    const { ran } = await jobsApi.withSweepLease("reports.purge", 10 * 60_000, () =>
      purgeExpired(),
    );
    if (!ran) return; // another worker holds this tick
  },
});
```

The claim is a conditional UPDATE — the database picks the winner — and only
a lost race is silent; a missing table or a dead store THROWS, so a stopped
sweep has a failed job to point at it. The `SweepLease` table ships with this
package (`prisma/jobs.prisma` + `prisma/migrations/`) and is synced into the
host's schema; partials and migrations are COPIED, never symlinked.
