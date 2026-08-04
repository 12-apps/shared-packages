# @12-apps/jobs

Typed background jobs — retries, exponential backoff and cron — behind a
swappable driver. BullMQ/Redis in production, inline execution in tests.

Framework-free: no Prisma, no Next, no host-app types. The logger is a port.

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

// at process start
import { createBullMqJobDriver } from "@12-apps/jobs/bullmq";  // not the barrel
configureJobs({ driver: createBullMqJobDriver({ redisUrl, logger }), logger });
await startJobWorkers();   // consumers only
```

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

Redis must run with `maxmemory-policy noeviction` — the driver checks and
complains. See [docs/JOBS.md](../../docs/JOBS.md) for the deployment side.
