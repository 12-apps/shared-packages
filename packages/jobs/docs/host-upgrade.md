# Upgrading future-pay from `@12-apps/jobs` 1.20.0 to 3.0.0

**Not published.** `package.json`'s `files` excludes `docs/**` explicitly, and
`src/__tests__/packed-artifact.test.ts` asserts it stays out of the tarball.
This note names one application throughout, which is precisely what 3.0.0
removed from everything that ships.

Every file:line below was read out of the consuming repository, not inferred.

Two majors, not one: 1.20.0 → 2.0.0 → 3.0.0.

---

## 1. The 2.0.0 half, and why it costs this host nothing

2.0.0 was cut by the commit that extracted the Prisma host out of
`@12-apps/shared-helpers` into `@12-apps/prisma`. `@12-apps/jobs`'s own source
did not change in it — the entire `packages/jobs` diff between `jobs-v1.20.0`
and `jobs-v2.0.0` is one path inside `ADOPTING.md` — but the release carries
that `BREAKING CHANGE:` footer, so the major is real. Its consequence:

- **`@12-apps/shared-helpers/prisma` is gone.** `getPrismaClient`, `setActor`,
  `normalizeSearchText` and friends come from `@12-apps/prisma` instead. A host
  still importing that subpath breaks at install, not at runtime.
- **The reference sync script moved** with it: the copy that reads
  `node_modules/@12-apps/jobs/prisma/jobs.prisma` now lives with the
  schema-owning package rather than inside shared-helpers.

For this host both are already true in source. It owns its own `@repo/prisma`
(`packages/prisma/scripts/sync-jobs-schema.mjs:8-9` reads
`../node_modules/@12-apps/jobs/prisma/jobs.prisma` and writes
`../prisma/schema/jobs.prisma`), and `apps/web/lib/jobs/lease.ts:2` already
imports `getPrismaClient` from `@repo/prisma`. A repo-wide
`grep -rn "@12-apps/shared-helpers/prisma"` returns **zero hits**; the only
shared-helpers pin left is `apps/web/package.json:45`
(`"@12-apps/shared-helpers": "1.22.0"`), used for `createFeatureLogger` at
`apps/web/lib/jobs/runtime.ts:3`.

So "two majors back" is one migration's worth of work, not two. Worth saying
out loud before anyone budgets for the second.

## 2. Bump the pins and the lockfile

Two manifests pin it, both at `1.20.0`:

- `apps/web/package.json:36` — `"@12-apps/jobs": "1.20.0"`
- `packages/prisma/package.json:65` — `"@12-apps/jobs": "1.20.0"`, declared so
  `turbo prune` keeps the partial's owner inside the build context. It imports
  nothing from the package.

Bump both, then `pnpm install --lockfile-only` and commit the lockfile — a
stale lockfile turns every `--frozen-lockfile` job red at once.

## 3. No Prisma re-sync — and why that is deliberate

`prisma/jobs.prisma` is **byte-identical** in 3.0.0, so
`packages/prisma/prisma/schema/jobs.prisma` needs no refresh and the drift
check stays green:

- `packages/prisma/package.json:21` (`build`) runs
  `node scripts/sync-jobs-schema.mjs --check`
- `packages/prisma/package.json:29` (`prisma:generate`) runs the same
- `packages/prisma/scripts/sync-jobs-schema.mjs:22-28` exits 1 on drift with
  `[jobs-schema] DRIFT: prisma/schema/jobs.prisma does not match the
  @12-apps/jobs partial. Run "pnpm --filter @repo/prisma prisma:sync-jobs" and
  commit the result.`

That partial *does* still carry two stale strings — this host's own
`billing.tick` as the example value of the `name` column
(`packages/jobs/prisma/jobs.prisma:39` in the package), and a
`packages/shared-helpers/scripts/...` sync path that 2.0.0 invalidated. They
were left in on purpose: the same drift check runs in the PACKAGE's repo too,
where editing the partial forces a write into that repo's own schema-host
package — a different release scope. The fix is a comment-only change that has
to ride a commit which can also run the sync on both sides.

**When it lands, this host does exactly this and nothing else:**

```bash
pnpm --filter @repo/prisma prisma:sync-jobs     # rewrites prisma/schema/jobs.prisma
pnpm --filter @repo/prisma prisma:generate      # then regenerate the client
```

and commits `packages/prisma/prisma/schema/jobs.prisma`. Until then, this
upgrade touches no Prisma artifact at all.

**And no migration diff, ever.** The migration SQL is byte-identical on
purpose: Prisma checksums an applied migration, and this directory is a copy of
one already applied in this host's production database. `prisma:sync-plugins`
(`packages/prisma/package.json:50`) has nothing to do here.

## 4. Nothing to change at the 15 `defineJob` sites

3.0.0 validates definitions at declaration. Every registration in
`apps/web/lib/jobs/` already passes — names are dot-namespaced and non-blank,
`attempts` is 1 or 3, stated `concurrency` is 1, backoff delays are 5s/10s, and
every cron pattern is exactly 5 fields:

| File:line | Job | Schedule |
|---|---|---|
| `apps/web/lib/jobs/notifications.ts:32` | `notifications.dispatch` | on emit — `attempts: 3`, exponential 10s |
| `apps/web/lib/jobs/notifications.ts:55` | `notifications.drain` | `*/5 * * * *` |
| `apps/web/lib/jobs/billing.ts:80` | `billing.tick` | `0 * * * *` UTC |
| `apps/web/lib/jobs/billing-charge.ts:77` | `billing.charge` | on enqueue — `attempts: 1` |
| `apps/web/lib/jobs/oauth-renewal.ts:115` | `payments.oauth-renewal` | `0 * * * *` |
| `apps/web/lib/jobs/payments.ts:67` | `payments.webhook-drain` | `*/5 * * * *` |
| `apps/web/lib/jobs/payments.ts:167` | `payments.reconcile-orders` | `*/5 * * * *` |
| `apps/web/lib/jobs/payments.ts:204` | `payments.reconcile-activations` | `*/5 * * * *` |
| `apps/web/lib/jobs/research.ts:89` | `research.run` | on enqueue — `attempts: 3` |
| `apps/web/lib/jobs/research.ts:179` | `research.reenqueue` | `*/10 * * * *` UTC |
| `apps/web/lib/jobs/retention.ts:142` | `retention.sweep` | `30 4 * * *` |
| `apps/web/lib/jobs/shifts.ts:8` | `shift.auto-close` | `*/15 * * * *` UTC |
| `apps/web/lib/jobs/stock.ts:63` | `stock.low-alert` | `0 7 * * *` America/Sao_Paulo |
| `apps/web/lib/jobs/stock.ts:133` | `stock.low-crossing` | `*/5 * * * *` UTC |
| `apps/web/lib/jobs/waiter-calls.ts:27` | `waiter-call.escalate` | `* * * * *` UTC |

`apps/web/lib/jobs/index.ts:16-27` imports eight of those modules for their
side effect and re-exports two more, so the thunk at
`apps/web/lib/jobs/runtime.ts:30-47` registers all 15. The new empty-`jobs`
guard passes as written; `runtime.ts` needs no change at all.

Three host call sites reach the runtime by hand, and all three stay valid:

- `apps/web/lib/jobs/lease.ts:20` — `createSweepLease({ db: () => getPrismaClient() })`
  off the package ROOT rather than the factory's bound `withSweepLease`. 3.0.0
  does not touch `createSweepLease`, and this is the path that made the
  "guards belong on the root, not only on the newest factory" rule concrete:
  the root entry point is what this host actually imports.
- `apps/web/tests/integration/realtime-roundtrip.integration.test.ts:120` —
  `configureJobs({ driver: createInlineJobDriver() })`, with an
  `emitKitchenUpdate` job it defines and then enqueues at lines 178-200. It is
  registered, so the new enqueue gate passes; it never calls
  `startJobWorkers`, so the empty-registry guard is not in its path.
- `apps/web/app/api/admin/[tenantSlug]/research/route.ts:58` and
  `apps/web/instrumentation.ts:113-114` — both call `bootstrapJobs()`
  (`apps/web/lib/jobs/runtime.ts:56`), which is `jobsApi.start()`. Unchanged.

One host test mocks the package wholesale:
`apps/web/lib/jobs/__tests__/billing-charge.test.ts:39-41`,
`vi.mock("@12-apps/jobs", () => ({ defineJob: (definition) => ({ ...definition,
enqueue: mockEnqueue }) }))`. Neither the validation nor the enqueue gate runs
under that mock, so it keeps passing untouched — and it is the one place in the
host where an unregistered-enqueue bug would still not be caught by the
package. Worth a comment there rather than a change.

## 5. Mount the health endpoint — it is currently not mounted at all

`grep -rn "jobsRouter"` over the repository returns **zero hits**. The
package's `/health` descriptor has never been mounted, so the deployment has no
probe for "is this worker actually consuming?" — the single signal that tells a
rolling deploy a drained worker from a live one, and the reason the drain hook
flips `consuming` before it starts awaiting.

`apps/web/app/api/internal/` already holds `health/route.ts` and
`tls-check/route.ts`, which is where it belongs. Adding
`app/api/internal/jobs/[[...path]]/route.ts` puts three committed/generated
gates in scope:

```bash
pnpm -C apps/web routes:generate       # rewrites server/routes.generated.ts
```

- The route table is committed and derived from the `app/**/route.ts` layout.
  `apps/web/server/routes.generated.ts:46-47` imports the two existing internal
  routes and `:518` is the `/api/internal/health` entry;
  `apps/web/server/__tests__/routes.generated.test.ts` fails until the
  regeneration is run, so a forgotten one is a red unit test in the pre-commit
  affected lane rather than a 404 after deploy.
- A new `route.ts` also brings in `pnpm mcp:check` / `pnpm mcp:coverage` and
  `pnpm -C apps/web run rbac:coverage`, all of which the pre-push hook runs.
- Mount it behind whatever guard `/api/internal/*` already carries. The package
  holds zero authorization logic, by design.

Optional for the upgrade to compile. Mandatory for it to be worth anything
operationally.

## 6. Wire the cross-package seams this host currently does without

All three packages are already in this workspace; none is connected to the
queue, and 3.0.0's `events` port is the first release where they can be.

- **Notifications on a dead-letter.** The wiring exists in the other direction
  only: `apps/web/lib/jobs/runtime.ts:39-46` installs
  `setNotificationDispatchScheduler` so a notification ENQUEUES a job. Nothing
  comes back — a job that exhausts its attempts writes a `logger.error` and
  stops. `events.onJobFailed` with `terminal: true` is that seam. Mind the
  ordering rule the host already documents at
  `apps/web/lib/jobs/runtime.ts:15-22`: the dispatch seam is installed inside
  the `jobs` thunk so it exists only when a driver does. An `onJobFailed` that
  notifies through the same pipeline inherits that rule — and must not try to
  notify about `notifications.dispatch` itself.
- **Audit on a removed schedule.** `@12-apps/audit` is in the workspace. A
  deploy that drops a `defineJob` silently removes its scheduler from Redis
  (the BullMQ driver's `reconcileSchedules` does this, and `logger.warn` was
  the only trace). `events.onScheduleRemoved` is the record.
- **Realtime on completion.** `apps/web/lib/realtime/surface.ts:70` already
  discusses enqueueing realtime events from `@12-apps/jobs`.
  `events.onJobCompleted` is the generic alternative for a job whose completion
  a tab is waiting on — `research.run` (`apps/web/lib/jobs/research.ts:89`,
  enqueued from `apps/web/app/api/admin/[tenantSlug]/research/route.ts:75`) is
  the obvious candidate.
- **Entitlements are deliberately NOT a seam here.** The package has no tenant
  axis at all — a sweep lease names a JOB, never a tenant — and adding one
  would move a host's quota model into the queue. A host that wants "this
  tenant may queue N research runs" gates it at the emit site, before
  `enqueue`. This host already keeps that allowance outside the queue:
  `apps/web/lib/research/host.ts:59-63` and
  `apps/web/lib/research/budget.ts:28-31` describe a per-tenant quota plus a
  global cap enforced as atomic conditional UPDATEs on
  `research_spend_counters` — the same doctrine as the sweep lease, in the
  host's own tables, and nothing the jobs package needs to know about.

## 7. The one API change that can fail a typecheck

`EnqueueSkipReason` gained `"unregistered"`. An exhaustive `switch` over it
stops compiling until the arm is handled. A repo-wide grep for
`EnqueueSkipReason` and for `reason ===` around `enqueue` results is the check;
this host currently reads `enqueue` results at
`apps/web/app/api/admin/[tenantSlug]/research/route.ts:75` and
`apps/web/lib/jobs/billing.ts:187`, neither of which switches on the reason.
