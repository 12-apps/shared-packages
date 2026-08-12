# Adopting @12-apps/jobs

This package is a **plug-and-play background-job runtime**: one library,
reusable across repositories, exposing standardized surfaces. A host repo only
*points* at these surfaces — when the library updates, every host updates with
**no app changes**. The contract below is the same one `@12-apps/report-builder`
and `@12-apps/payments-backend` established.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core library** | `@12-apps/jobs` | `defineJob` next to the domain each job belongs to (the import IS the registration), `enqueue` at emit sites, `SWEEP_QUEUE` + `createSweepLease` for scheduled sweeps. Never drags Redis into a bundle. |
| **Server** | `@12-apps/jobs/server` | Call `createApiJobs(config)` once at process start: driver resolution (with the inline zero-config default and the production refusals), job registration, the `JOBS_WORKER` producer/consumer switch, graceful drain on `SIGTERM`/`SIGINT`, the bound sweep lease, and the health endpoint as framework-neutral route descriptors. |
| **Hono** | `@12-apps/jobs/hono` | `app.route(prefix, jobsRouter(jobsApi))`. A one-call mount for hosts on Hono; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **Drivers** | `@12-apps/jobs/bullmq`, `@12-apps/jobs/inline` | Nothing, usually — `createApiJobs` resolves them. Import directly only to hand a pre-built instance in (`driver: createInlineJobDriver({ await: true })` in a test). |
| **Prisma** | `prisma/jobs.prisma` + `prisma/migrations/*` | Sync BOTH into the host's schema/migrations folders as **copies** (see below). One table: `sweep_leases`. |

## Why there is no `createWebJobs`

The porting contract asks for both halves — `createApiFoo` and `createWebFoo`
— and this package deliberately ships only the first. The runtime is headless:
it has no screens, no flows and no routes a user ever sees. Its API surface is
the health endpoint (`GET /health` on the mounted routes), which exists for
probes and dashboards, not for people; its user-visible effects are whatever
the HOST's job handlers do, and those handlers are exactly the part that stays
in the host. Inventing a web half here would mean shipping an admin UI for a
queue this package does not own the semantics of — that is a different
product (and BullMQ already has several). If a host wants a jobs dashboard,
it reads the same health endpoint every other probe reads.

## Host wiring rules (the ones that bite)

1. **The host owns the handlers; this package owns the running of them.**
   Job definitions, their retry policies and their schedules are host domain —
   they stay in the host, declared with `defineJob` next to the code they
   belong to. What moved here is everything operational: which driver runs,
   when workers start, how they drain, who may run a sweep.
2. **Payloads carry identifiers, never state**, and every handler is
   idempotent — delivery is at-least-once. Both rules are documented on
   `JobDefinition`; they are the design the whole package rests on. Pair every
   job with a durable row a sweep can re-find: the enqueue is only the fast
   path, and `enqueue` never throws.
3. **Duck-typed DB, never a generated client.** The sweep lease takes the
   host's Prisma client through a structural seam (`SweepLeaseDb`), as a lazy
   provider: `db: () => getPrismaClient()`. A non-Prisma adapter must honour
   one contract: `create` rejects a duplicate primary key with an error
   carrying `code: "P2002"` — that is the one error the claim reads as "lost
   the race" rather than "the store is broken".
4. **The zero-config default is a real mode, keep it reachable.** A fresh
   host with no `REDIS_URL` must boot green: `createApiJobs` resolves the
   inline driver outside production (handlers in-process, schedules off and
   logged). Do not "fix" that by demanding Redis in dev.
5. **Fail closed, never fail loud.** In production every misconfiguration
   (no `REDIS_URL`, `inline` requested, a bad URL) resolves to NO driver plus
   a loud error log and a 503 from `/health`. Enqueues then report
   `no-driver`; the durable rows still get written. A queue must never take
   the host app down.
6. **Auth for the health endpoint is the host's.** Mount `jobsRouter` under
   whatever guard the deployment's internal probes live behind (future-pay
   answers `/api/internal/*` only machine-to-machine). The package holds zero
   authorization logic.
7. **Sweeps: one queue, one flight, one lease.** Declare scheduled sweeps
   with `queue: SWEEP_QUEUE, concurrency: 1` and take
   `withSweepLease(name, ttlMs, work)` inside the handler. The TTL must
   comfortably exceed the sweep's own duration — a lease expiring mid-sweep
   is the one way two workers can still overlap. Only a lost race is silent;
   a real store fault throws, so a stopped sweep has a failed job to notice.

## Configuration

`createApiJobs(config)` — every field optional except `jobs`; unset fields
default from the environment, which is what makes the mount one line:

| Config | Env default | Meaning |
|---|---|---|
| `jobs` | — | An import thunk (`() => import("./jobs")`) or an array of `defineJob` returns. Registration. |
| `driver` | `JOBS_DRIVER` | `bullmq` \| `inline` \| `off`, or a `JobDriver` instance. Unset → `bullmq` when a Redis URL exists, else `off` in production, `inline` elsewhere. |
| `redisUrl` | `REDIS_URL` | Setting it turns the queue on. |
| `worker` | `JOBS_WORKER` (`1`/`true`) | This process consumes and runs schedules, not just enqueues. |
| `production` | `NODE_ENV === "production"` | Refuses `inline`, makes "no queue" loud. |
| `queuePrefix` | `JOBS_QUEUE_PREFIX` | Share one Redis across environments. |
| `logger` | console | Structurally a winston logger or `console`. |
| `db` | — | `() => SweepLeaseDb` — enables `withSweepLease`. Without it the lease throws on first use (loud, never a silent skip). |
| `installShutdownHooks` | `true` | `SIGTERM`/`SIGINT` drain in-flight jobs (workers only). Off in tests. |

## The endpoints

Mounted under whatever prefix the host chooses (recommended: wherever its
internal probes live, e.g. `/api/internal/jobs`):

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | 200 `{ status: "ok", checks }` when the runtime is in its intended state; 200 `{ status: "disabled", checks }` when jobs are off **by explicit choice outside production** (`JOBS_DRIVER=off` / `driver: "off"` — a review box or CI must not fail a readiness aggregate forever); 503 `{ status: "degraded", checks }` for everything wrong rather than chosen — a misconfiguration, a `start()` that threw, a worker that stopped consuming, and ANY production with no queue, spelled out or not: production never deliberately wants none, so an explicit off that reaches it through a shared env template still probes red. `checks` reports the resolved driver kind, producer/consumer role, consuming state, and the registered job/schedule counts. |

## The Prisma partial — copies, never symlinks

The `SweepLease` model and its migration ship in this package:

```
packages/jobs/prisma/jobs.prisma          # the model partial
packages/jobs/prisma/migrations/          # its migration
```

A host adopts them by COPY (the entity-lifecycle / shift precedent — in this
repo, `packages/shared-helpers/scripts/sync-jobs-schema.mjs` plus the
structural migration sync in `sync-prisma-plugins.mjs`):

- **Migrations are copied, never symlinked.** Prisma enumerates the
  migrations folder with `lstat`, so a symlinked migration reports
  `isDirectory() === false` and is silently skipped — a green deploy that
  changed no schema.
- **The partial is copied too**, and the owning package must be a **declared
  dependency** of whichever host package owns the schema folder: `turbo prune`
  copies only what the dependency graph reaches, and an undeclared owner is
  dropped from the build context.
- Never edit the synced copy by hand; re-run the sync. The `--check` variant
  is the CI gate against drift.
- **The migration's timestamp (`20260727190000`) may sort before migrations
  your host has already applied.** That is deliberate: the directory is a
  byte-identical copy of the one future-pay already has in production, so a
  rename would make that host's sync try to create a second table. For every
  other host the out-of-order arrival is safe — `prisma migrate dev` may
  grumble, but the SQL is `CREATE TABLE IF NOT EXISTS`, so even a double
  apply is inert.

## Porting to another repo

1. Add the package and sync the partial + migration into your schema-owning
   package (adjust the two paths in your copy of the sync script); declare
   `@12-apps/jobs` as that package's dependency; `prisma generate`.
2. Declare your jobs with `defineJob` and collect the modules behind one
   import (`lib/jobs/index.ts` importing each for its side effect).
3. Mount: `createApiJobs({ jobs: () => import("./lib/jobs"), db: () => yourClient })`,
   `await jobsApi.start()` at process start, `app.route(prefix, jobsRouter(jobsApi))`.
4. Deploy shape: the worker is the SAME image with `JOBS_WORKER=1`. Redis
   needs `maxmemory-policy noeviction` (the driver checks and complains) and
   AOF persistence. More than one worker is safe for sweeps that take the
   lease.
