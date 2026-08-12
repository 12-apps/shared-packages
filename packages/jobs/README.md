# @12-apps/jobs

Typed background jobs — retries, exponential backoff and cron — behind a
swappable driver. BullMQ/Redis in production, inline execution in tests and
zero-config development.

Framework-free: no Prisma import, no Next, no host-app types. The logger is a
port, the lease's database is a structural seam, and the one web framework in
sight (`hono`) is an optional peer behind its own subpath.

```ts
// where the domain lives — the import IS the registration
export const dispatchNotification = defineJob<{ notificationId: string }>({
  name: "notifications.dispatch",
  attempts: 5,
  backoff: { type: "exponential", delayMs: 5_000 },
  handle: async ({ notificationId }) => dispatchDeliveries(notificationId),
});

// a job that only ever runs on a schedule needs no binding at all
defineJob({
  name: "notifications.drain",
  schedule: { pattern: "*/5 * * * *", timezone: "UTC" },
  handle: async () => drainPending(),
});

// at an emit site
await dispatchNotification.enqueue({ notificationId }, { dedupeKey: notificationId });

// at process start — ONE call wires driver, workers, drain, lease and health
import { createApiJobs } from "@12-apps/jobs/server";
import { jobsRouter } from "@12-apps/jobs/hono";

const jobsApi = createApiJobs({
  jobs: () => import("./lib/jobs"),   // the defineJob modules
  db: () => getPrismaClient(),        // the sweep_leases table (optional)
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

The full adoption contract — config seam, env variables, the sweep lease, the
Prisma partial and why there is no `createWebJobs` — is in
[ADOPTING.md](./ADOPTING.md).

## The two rules

**Payloads carry identifiers, never state.** `{ notificationId }`, not the
rendered e-mail. The database is the source of truth; the queue only decides
*when*. A payload that duplicates a row is a second copy that can disagree with
it, and it is the copy that gets acted on days later.

**Handlers are idempotent.** Delivery is at-least-once — a worker can die
between the side effect and the acknowledgement. Lean on the database's unique
constraints, not on the queue.

## Guarantees and non-guarantees

- `enqueue` **never throws**. A queue outage returns `{ enqueued: false }` and
  logs; it does not fail the request that was deferring work.
- Bounded Redis memory: completed jobs are kept a day, failed ones a week.
- Schedules are **reconciled** on start — a cron job deleted from code has its
  scheduler removed from Redis, instead of firing forever at a handler that no
  longer exists.
- The `inline` driver honours `attempts` but not delays or schedules, and both
  omissions are logged rather than silent. It is refused in production by the
  host, not by this package.

The BullMQ driver is exported from `@12-apps/jobs/bullmq`, never the barrel, so
importing `defineJob` at an emit site does not drag Redis into the bundle.
`createApiJobs` keeps the same property: it imports the BullMQ driver lazily,
only in a process whose resolution actually picked it.

Redis must run with `maxmemory-policy noeviction` — the driver checks and
complains.

## The sweep lease

Scheduled sweeps declare `queue: SWEEP_QUEUE, concurrency: 1`, which makes
them single-flight within one worker. Across replicas that guarantee needs a
named, time-bounded claim in the DATABASE — `createSweepLease` (or the bound
`withSweepLease` on the `createApiJobs` return):

```ts
defineJob({
  name: "billing.tick",
  queue: SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: "0 * * * *" },
  handle: async () => {
    const { ran, result } = await jobsApi.withSweepLease("billing.tick", 10 * 60_000, () =>
      runBillingTick(),
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
