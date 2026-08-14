# Adopting @12-apps/jobs

This package is a **plug-and-play background-job runtime**: one library,
reusable across repositories, exposing standardized surfaces. A host repo only
*points* at these surfaces — when the library updates, every host updates with
**no app changes**.

It contains no job of its own. Not one name, not one schedule, not one retry
policy, not one queue tuned to a product's SLA — those are the host's, and they
arrive as config. What the package owns is the RUNNING of them.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Core library** | `@12-apps/jobs` | `defineJob` next to the domain each job belongs to (the import IS the registration), `enqueue` at emit sites, `DEFAULT_QUEUE` / `SWEEP_QUEUE` + `createSweepLease` for scheduled sweeps. Never drags Redis into a bundle. |
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
   belong to. What lives here is everything operational: which driver runs,
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
5. **Fail closed, never fail loud — about the QUEUE.** In production every
   misconfiguration (no `REDIS_URL`, `inline` requested, a bad URL) resolves to
   NO driver plus a loud error log and a 503 from `/health`. Enqueues then
   report `no-driver`; the durable rows still get written. A queue must never
   take the host app down.
6. **But the WIRING fails loud, on purpose.** A `jobs` that names nothing, a
   definition that cannot run, an enqueue of a job the registry does not hold:
   each of those is refused with a throw or a refused result. They are not
   queue outages, they are programming errors, and every one of them is
   otherwise completely silent. See "What it refuses" below.
7. **Auth for the health endpoint is the host's.** Mount `jobsRouter` under
   whatever guard the deployment's internal probes live behind. The package
   holds zero authorization logic.
8. **Sweeps: one queue, one flight, one lease.** Declare scheduled sweeps
   with `queue: SWEEP_QUEUE, concurrency: 1` and take
   `withSweepLease(name, ttlMs, work)` inside the handler. The TTL must
   comfortably exceed the sweep's own duration — a lease expiring mid-sweep
   is the one way two workers can still overlap. Only a lost race is silent;
   a real store fault throws, so a stopped sweep has a failed job to notice.

## What it refuses

Each of these produces, if let through, a deployment that starts, probes green
and quietly does nothing.

| Refused | Where | Why it is not "a choice" |
|---|---|---|
| `defineJob({ name: "" })`, `queue: ""`, `attempts: 0`, `concurrency: 0`, `backoff.delayMs: 0`, `schedule.pattern: "@daily"` / `""` / `"0 *"` | `defineJob`, at declaration | `InvalidJobDefinitionError`. `queue: ""` is not nullish, so it never falls back to `DEFAULT_QUEUE` — it makes a queue no worker is started for. A non-5/6-field cron installs a scheduler that never fires. |
| `createApiJobs({ jobs: [] })` | the factory, at assembly | `JobsConfigError`. Declaring nothing is not how jobs are turned off — `JOBS_DRIVER=off` is, and it reports `status: "disabled"` rather than a green `ok` over an empty runtime. |
| a `jobs` thunk that registers nothing | `start()` | `NoJobsRegisteredError`. This is the common one: a dropped import in the host's jobs barrel. Both roles are checked — a producer that registered nothing enqueues nothing. |
| `startJobWorkers()` with an empty registry | the root entry point | `NoJobsRegisteredError`, the same guard. A host that wires the runtime by hand is not a host with fewer checks. |
| `enqueue` of a definition the registry does not hold under that name | `enqueueJob`, and the BullMQ driver's own `enqueue` | `{ enqueued: false, reason: "unregistered" }`. It is the SAME `resolveRegisteredJob` call the worker's dispatch makes, so a write cannot be accepted that the run side then refuses. Identity, not just the name: an impostor object would ship a payload the real handler never agreed to. |

## Configuration

`createApiJobs(config)` — every field optional except `jobs`; unset fields
default from the environment, which is what makes the mount one line:

| Config | Env default | Meaning |
|---|---|---|
| `jobs` | — | **Required, and may not be empty.** An import thunk (`() => import("./jobs")`) or a non-empty array of `defineJob` returns. Registration. |
| `driver` | `JOBS_DRIVER` | `bullmq` \| `inline` \| `off`, or a `JobDriver` instance. Unset → `bullmq` when a Redis URL exists, else `off` in production, `inline` elsewhere. |
| `redisUrl` | `REDIS_URL` | Setting it turns the queue on. |
| `worker` | `JOBS_WORKER` (`1`/`true`) | This process consumes and runs schedules, not just enqueues. |
| `production` | `NODE_ENV === "production"` | Refuses `inline`, makes "no queue" loud. |
| `queuePrefix` | `JOBS_QUEUE_PREFIX` | Share one Redis across environments. |
| `logger` | console | Structurally a winston-style logger or `console`. |
| `events` | — | `JobEvents` — dead-letters, completions and removed schedules, for the host to wire to its own notifier / audit / realtime. See below. |
| `retention` | package default | How long finished jobs are kept: a day of successes, a week of failures. Override for a longer support window. All four numbers must be positive and finite — see the warning below. |
| `defaultConcurrency` | `5` | Per-queue concurrency when no job on the queue states one. A stated `concurrency: 1` still wins. |
| `db` | — | `() => SweepLeaseDb` — enables `withSweepLease`. Without it the lease throws on first use (loud, never a silent skip). |
| `installShutdownHooks` | `true` | `SIGTERM`/`SIGINT` drain in-flight jobs (workers only). Off in tests. |

### ⚠️ A non-positive `retention` does not shrink retention

It stops bounding the backend altogether. BullMQ derives its count trim from
the number it is handed, so a NEGATIVE `count` removes one job per completion
instead of holding the set at a ceiling — which is the unbounded completed-set
the default exists to prevent, arrived at through a config knob. Nothing
throws at the queue, no probe reddens, and the symptom is a Redis that fills up
weeks later and starts refusing writes.

`NaN` is the likelier way in:

```ts
// ✗ With JOBS_KEEP_H unset this is NaN, and every comparison in the trim
//   silently answers false.
retention: { completed: { ageSeconds: Number(process.env.JOBS_KEEP_H), count: 1_000 }, … }
```

So all four numbers are validated — `createApiJobs` refuses at ASSEMBLY with
`InvalidJobRetentionError`, and `createBullMqJobDriver` refuses again for a
host that builds the driver off `@12-apps/jobs/bullmq` itself. Omitting
`retention` is always fine and means "use the package default".

### `events` — what this package will not do for you

It notifies nobody, audits nothing and publishes no realtime event. It owns
the MOMENT and exports it; the consequence is the host's, wired with the
host's own packages:

```ts
createApiJobs({
  jobs: () => import("./lib/jobs"),
  events: {
    onJobFailed: ({ name, error, terminal }) => {
      // `terminal` is the whole point: no attempt is left. A non-terminal
      // failure is ordinary retry noise and must not page anyone.
      if (terminal) void notifyOperators(name, error);
    },
    onJobCompleted: ({ name, runId }) => void publishRealtime(name, runId),
    onScheduleRemoved: ({ name, queue }) =>
      void audit("schedule.removed", { name, queue }),
  },
});
```

An observer that throws or rejects is logged and swallowed — somebody else's
code must never be able to fail the job it is watching, nor the reconcile that
was cleaning up a stale schedule.

`onScheduleRemoved` fires only for REMOVAL, not installation. Installation is
an idempotent upsert that runs on every boot of every worker, so auditing it
would write one row per schedule per deploy; removal is a deploy permanently
cancelling a recurring job, which is the half worth a record.

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

A host adopts them by COPY, from a sync script in whichever of its packages
owns the schema folder:

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
  byte-identical copy of one already applied in production, so a rename would
  make that host's sync try to create a second table. For every other host the
  out-of-order arrival is safe — `prisma migrate dev` may grumble, but the SQL
  is `CREATE TABLE IF NOT EXISTS`, so even a double apply is inert.
- **Those bytes are frozen, comment and all.** Prisma checksums an applied
  migration; changing so much as a comment makes `migrate deploy` refuse the
  next deploy of every host that already ran it. That is why the packed-artifact
  sweep carries exactly one exemption, scoped to one literal on that one path
  (`src/__tests__/packed-artifact.test.ts`), rather than editing the file.

## Porting to another repo

1. Add the package and sync the partial + migration into your schema-owning
   package; declare `@12-apps/jobs` as that package's dependency;
   `prisma generate`.
2. Declare your jobs with `defineJob` and collect the modules behind one
   import (`lib/jobs/index.ts` importing each for its side effect).
3. Mount: `createApiJobs({ jobs: () => import("./lib/jobs"), db: () => yourClient })`,
   `await jobsApi.start()` at process start, `app.route(prefix, jobsRouter(jobsApi))`.
4. Deploy shape: the worker is the SAME image with `JOBS_WORKER=1`. Redis
   needs `maxmemory-policy noeviction` (the driver checks and complains) and
   AOF persistence. More than one worker is safe for sweeps that take the
   lease.

---

# Migrating to 3.0.0 — the app-agnostic release

3.0.0 does two things: it removes the origin application from a package
published as generic, and it closes three fail-open paths that were invisible
by construction.

## What changed in behaviour

Nothing was **removed** from the API — every 2.0.0 export still exists with the
same signature. What changed is that four things that used to be accepted are
now refused, and one union grew a member.

| Was accepted | Now | Where |
|---|---|---|
| a definition with a blank `name`, an empty `queue`, `attempts: 0`, `concurrency: 0`, `backoff.delayMs: 0`, or a cron pattern that is not 5/6 fields | throws `InvalidJobDefinitionError` | `defineJob` |
| `createApiJobs({ jobs: [] })` | throws `JobsConfigError` at the factory | `@12-apps/jobs/server` |
| a `jobs` thunk that registers nothing | `start()` rejects with `NoJobsRegisteredError`; `/health` stays 503 | `@12-apps/jobs/server` |
| `startJobWorkers()` with an empty registry | rejects with `NoJobsRegisteredError` | `@12-apps/jobs` (root) |
| `enqueue` of an unregistered definition — written to the backend, then dead-lettered by the consumer | `{ enqueued: false, reason: "unregistered" }`, nothing written | `enqueueJob`, `RegisteredJob.enqueue`, and the BullMQ driver |

**`EnqueueSkipReason` gained `"unregistered"`.** An exhaustive `switch` over it
will not compile until the new arm is handled. That is the intended failure:
the reason exists precisely because the outcome used to be indistinguishable
from success.

## What is new

| Added | What for |
|---|---|
| `events?: JobEvents` on `createApiJobs`, and on both driver factories | Dead-letters (`onJobFailed` with `terminal`), completions (`onJobCompleted`) and removed schedules (`onScheduleRemoved`). The package still notifies/audits/publishes nothing itself. |
| `retention?: JobRetention`, `defaultConcurrency?: number` | The two operational numbers that were hardcoded. The defaults are unchanged (a day / a week; concurrency 5), so omitting them is a no-op. `retention` is validated at assembly and again in the driver — a non-positive window stops bounding the backend rather than shrinking it. |
| `assertValidRetention`, `InvalidJobRetentionError` | The retention check, exported so a host that assembles its own window can run it. Lives in `core`, so importing it never pulls `bullmq` into a bundle that only enqueues. |
| `DEFAULT_QUEUE` | The queue name a definition falls back to, exported instead of duplicated as a literal in every host. |
| `resolveRegisteredJob`, `InvalidJobDefinitionError`, `NoJobsRegisteredError`, `JobsConfigError` | The gate and the three refusals, so a host can catch them by type. |

## Host vocabulary that left the tarball

`files` publishes `src` (minus tests), `prisma` and every top-level `*.md`, so
all of this was shipping to every adopter:

- the origin application was named 19 times, across four published source files
  and this one;
- **its job identifiers were the examples** — in the README, the root module
  header, the payload rule on `JobDefinition`, the inline driver's docs, the
  runtime's own comments and the `SweepLease` schema annotation. A jobs
  package's examples ARE job identifiers, which is exactly what made this the
  easiest leak to read straight past: they look like documentation and they are
  another product's schedule names.
- its billing vocabulary and its own timezone sat in the payload rule and in
  the `JobSchedule` docs, so an adopter's night job inherited a zone chosen for
  somebody else.

`src/__tests__/packed-artifact.test.ts` now asks `npm pack --dry-run --json`
what would be uploaded, reads every entry off disk and greps it, with a plant
test so a green run means something.

### The two strings that have NOT left, and why

Both are in files whose BYTES are pinned to something outside this package, so
neither is fixable by editing the string. The sweep exempts exactly those two
literals on exactly those two paths — never the file, never the word
elsewhere — and the suite proves the scoping.

- `prisma/migrations/.../migration.sql` keeps a ticket reference in its header
  comment. Prisma checksums an applied migration; changing a comment makes
  `migrate deploy` refuse the next deploy of every host that already ran it.
  This one is permanent.
- `prisma/jobs.prisma` still uses a host's job name as the example value of the
  `name` column, and still names a pre-2.0.0 path for the sync script. That
  file is byte-compared against a **committed copy in the schema-host package**
  (`sync-jobs-schema.mjs --check`, wired into that package's `build` and
  `prisma:generate`), so a one-byte edit here turns the workspace's
  `check-types` red until the copy is re-synced — a write in another package's
  directory, which the release tooling reads as a release of that package. It
  is a two-line comment fix that must ride the commit which can also carry
  `prisma:sync-jobs`, and it is the one item this release deliberately left.

## Upgrading a host that is on 1.20.0

Two majors, and 2.0.0's break is not in this package's own API — it was cut by
the commit that moved the Prisma host out of `@12-apps/shared-helpers` into
`@12-apps/prisma`, so `@12-apps/shared-helpers/prisma` is gone and the
reference sync script moved with it. `packages/jobs`'s own diff for that
release was a single path in this file.

The concrete, anchored upgrade for this repo's own consumer — the pins, the
partial re-sync and the generated copy it invalidates, the health endpoint that
was never mounted, and the cross-package seams now available — is in
`packages/jobs/docs/host-upgrade.md`. It is deliberately NOT published: it
names one application throughout, which is the whole thing this release was
about.
