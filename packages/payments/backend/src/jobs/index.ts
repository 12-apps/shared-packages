/**
 * The payments package's own background work (FUT-760).
 *
 * ## Why this file exists
 *
 * `reconcilePendingCharges` has been in this package since FUT-761 — the sweep
 * that asks the provider about charges nobody settled, which is what rescues a
 * payment whose webhook went missing. What the package never shipped was the
 * SCHEDULE. Every host had to notice the export, decide a cadence, pick a
 * queue, take a single-writer lease and wire the settle port itself.
 *
 * Exactly one host did. The others mount the endpoints, take the charges, and
 * silently have no reconciliation at all: a buyer whose webhook is dropped
 * stays unpaid on their screen forever, and nothing in either repo fails to
 * say so. A mechanism a host has to remember to schedule is a mechanism most
 * hosts do not have.
 *
 * ## Why it declares blueprints instead of importing a job library
 *
 * This package must stay vendorable into a repo that has no `@12-apps/jobs`
 * (ADOPTING.md §6, enforced by `payments/no-host-imports`). So the CADENCE,
 * the queue, the concurrency and the handler are declared here as plain data,
 * against a structural type of our own — and the host hands them to whichever
 * runner it uses:
 *
 *     // with @12-apps/jobs
 *     const { jobs } = defineJobModule<PaymentsJobDeps>()({
 *       namespace: 'payments',
 *       jobs: paymentsJobBlueprints(),
 *     }).mount({ charges, gateway, settle });
 *     createApiJobs({ jobs: [...jobs, ...ownJobs] });
 *
 * `PaymentsJobBlueprint` is deliberately structurally identical to that
 * package's `JobBlueprint`, so the two type-check against each other with no
 * import in either direction. A host on a different scheduler reads the same
 * fields and installs them its own way; nothing here assumes BullMQ, Redis or
 * a cron implementation.
 *
 * What the host is never asked for is the POLICY. The five-minute tick, the
 * single-flight queue and the batch window are money decisions — two
 * overlapping passes double the provider calls and race each other's settles —
 * and a host asked to restate them is a host that can get them wrong.
 */

import { reconcilePendingCharges, type PendingSweepDeps } from '../core/payable-sweep';

/**
 * What the host supplies once, when it binds these blueprints.
 *
 * Deliberately the SAME shape `reconcilePendingCharges` already takes: the
 * store, a gateway that can re-read a charge, and the host's own idempotent
 * settle path. Nothing new to implement for a host that had already wired the
 * sweep by hand — it deletes its scheduling and passes the same object.
 */
export interface PaymentsJobDeps extends PendingSweepDeps {
  /** Overridable clock, for a suite that drives the window deterministically. */
  now?: () => Date;
}

/** What a handler is told about the attempt it is running in. */
export interface PaymentsJobContext {
  logger: { info(message: string): void; warn(message: string): void; error(message: string): void };
}

/**
 * One unit of deferred work this package needs, with the host's deps left open.
 *
 * Structurally identical to `@12-apps/jobs`'s `JobBlueprint` on purpose — see
 * the file header. Everything here is inert data until a host binds it.
 */
export interface PaymentsJobBlueprint<TPayload = void> {
  /** Short name; the host's module namespaces it (`payments.reconcile-pending`). */
  name: string;
  /** Queue hint. `sweeps` is the single-flight queue the scheduled passes share. */
  queue?: string;
  concurrency?: number;
  schedule?: { pattern: string; timezone?: string };
  handle: (
    payload: TPayload,
    deps: PaymentsJobDeps,
    context: PaymentsJobContext,
  ) => Promise<void>;
}

/**
 * The single-flight queue name. Stated as a literal rather than imported for
 * the reason in the header; it is the same string `@12-apps/jobs` exports as
 * `SWEEP_QUEUE`, and `paymentsJobBlueprints.test.ts` pins the pair.
 */
export const PAYMENTS_SWEEP_QUEUE = 'sweeps';

/** Five minutes — the resolution at which "paid but still pending" is a delay. */
export const RECONCILE_CRON = '*/5 * * * *';

/**
 * Ask the provider about charges still waiting.
 *
 * On the sweep queue at concurrency 1, which is not tuning: two passes
 * overlapping would double the provider calls and race each other's settles.
 * The window itself (a two-minute grace, a 24-hour abandon, 40 per pass) is
 * the sweep's own and is documented on `PendingSweepOptions`.
 *
 * It never throws — a provider outage must not fail the job and trigger a
 * retry storm against an acquirer that is already down. The next tick asks
 * again, which is the whole recovery model.
 */
const reconcilePending: PaymentsJobBlueprint = {
  name: 'reconcile-pending',
  queue: PAYMENTS_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: RECONCILE_CRON },
  handle: async (_payload, deps, context) => {
    const report = await reconcilePendingCharges(deps, {
      now: (deps.now ?? (() => new Date()))(),
    });
    if (report.checked > 0) {
      context.logger.info(
        `[payments] reconcile-pending checked ${report.checked}: ` +
          `${report.settled} settled, ${report.failed} failed`,
      );
    }
  },
};

/**
 * Every job this package needs a host to run, keyed as a job module expects.
 *
 * A function rather than a const so a host cannot mutate the shared object,
 * and so a future blueprint can take package-level options without changing
 * the call site.
 */
export function paymentsJobBlueprints(): {
  readonly reconcilePending: PaymentsJobBlueprint;
} {
  return { reconcilePending };
}
