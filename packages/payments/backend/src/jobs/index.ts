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

import { PAYMENTS_SWEEP_QUEUE, RECONCILE_CRON } from './cadence';

export {
  ACTIVATION_RECONCILE_CRON,
  OAUTH_RENEWAL_BATCH,
  OAUTH_RENEWAL_CRON,
  OAUTH_RENEW_WITHIN_MS,
  PAYMENTS_SWEEP_QUEUE,
  RECONCILE_CRON,
  WEBHOOK_DRAIN_CRON,
} from './cadence';

import type { WebhookReplayOptions, WebhookReplayReport } from '../core/webhook-replay';
import type { ExpiringConnection, ProviderConfigStore, StoredProviderConfig } from '../config/types';
import type { MerchantRef, ProviderName } from '../core/types';
import type {
  ActivationReconcileContext,
  ActivationReport,
} from '../activation/reconcile';

/**
 * Why a grant could not be renewed — the two outcomes a host must be able to
 * tell apart, because only one of them means the tokens are GONE.
 */
export type ReconnectReason = 'refused' | 'lost';

/** The OAuth seam the renewal sweep needs, and nothing more. */
export interface PaymentsOAuthJobDeps {
  /** The connections whose grants lapse before a given instant. */
  listExpiring: ProviderConfigStore['listExpiring'];
  /**
   * Renew one grant. Records `RECONNECT_REQUIRED` rather than throwing when
   * the provider refuses, so a resolved promise is NOT automatically a
   * success — the sweep reads the status back.
   */
  refresh(merchant: MerchantRef, provider: ProviderName): Promise<StoredProviderConfig>;
  /**
   * Tell the merchant they must reauthorize. Optional, and fire-and-forget by
   * contract: an alert must not cost the rest of the batch. Absent, the
   * failure still reaches the logger — it just reaches nobody who can fix it.
   */
  onReconnectRequired?: (connection: ExpiringConnection, reason: ReconnectReason) => void;
}

/**
 * What the host supplies once, when it binds these blueprints.
 *
 * Every field is REQUIRED, and that is the contract's doctrine rather than an
 * oversight: a partially-supplied deps object would make a declared sweep a
 * silent no-op, which is the exact incident this whole seam exists to end. A
 * host with no OAuth providers writes `listExpiring: () => Promise.resolve([])`
 * — one line at the bind site that says so in code, which is a written decline
 * and not a gap.
 */
export interface PaymentsJobDeps extends PendingSweepDeps {
  /** Overridable clock, for a suite that drives the window deterministically. */
  now?: () => Date;
  /**
   * The webhook inbox drain. `gateway` already carries it — a host passing its
   * whole gateway (the wiring in practice) needs no change beyond widening the
   * `Pick`.
   */
  replayWebhooks(options?: WebhookReplayOptions): Promise<WebhookReplayReport>;
  /** The stranded-activation reconcile\'s context, over the host\'s tables. */
  activation: ActivationReconcileContext;
  /** The OAuth renewal seam. */
  oauth: PaymentsOAuthJobDeps;
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
  /** Total tries. `1` means the next scheduled tick IS the retry. */
  attempts?: number;
  /**
   * Single-flight fence: a runner that can hold leases takes the name for
   * `ttlMs` before running, and a tick that finds it held skips silently.
   * Concurrency alone bounds one process; the lease bounds ALL of them.
   */
  lease?: { ttlMs: number };
  handle: (
    payload: TPayload,
    deps: PaymentsJobDeps,
    context: PaymentsJobContext,
  ) => Promise<void>;
}

/**
 * What the host supplies once, when it binds these blueprints.
 *
 * Deliberately the SAME shape `reconcilePendingCharges` already takes: the
 * store, a gateway that can re-read a charge, and the host's own idempotent
 * settle path. Nothing new to implement for a host that had already wired the
 * sweep by hand — it deletes its scheduling and passes the same object.
 */
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
  /** Total tries. `1` means the next scheduled tick IS the retry. */
  attempts?: number;
  /**
   * Single-flight fence: a runner that can hold leases takes the name for
   * `ttlMs` before running, and a tick that finds it held skips silently.
   * Concurrency alone bounds one process; the lease bounds ALL of them.
   */
  lease?: { ttlMs: number };
  handle: (
    payload: TPayload,
    deps: PaymentsJobDeps,
    context: PaymentsJobContext,
  ) => Promise<void>;
}


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
  // Never retried by the queue: the handler never throws (see below), and the
  // next five-minute tick re-finds everything from durable state anyway.
  attempts: 1,
  // One pass may hold the single-flight name for up to five minutes — the
  // cadence itself. The origin host stated this by hand for as long as it was
  // the only host with a sweep; it is the sweep's own claim.
  lease: { ttlMs: 5 * 60_000 },
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

import { oauthRenewal, reconcileActivations, webhookDrain } from './sweeps';

/**
 * Every job this package needs a host to run, keyed as a job module expects.
 *
 * A function rather than a const so a host cannot mutate the shared object,
 * and so a future blueprint can take package-level options without changing
 * the call site.
 */
export function paymentsJobBlueprints(): {
  readonly reconcilePending: PaymentsJobBlueprint;
  readonly webhookDrain: PaymentsJobBlueprint;
  readonly reconcileActivations: PaymentsJobBlueprint;
  readonly oauthRenewal: PaymentsJobBlueprint;
} {
  return { reconcilePending, webhookDrain, reconcileActivations, oauthRenewal };
}

/**
 * The same declaration as a `@12-apps/wiring` jobs contribution — namespace
 * plus blueprints — so a wiring host binds it through `adoptServer` instead
 * of hand-wiring `defineJobModule`.
 *
 * UNTYPED on purpose: `payments/no-host-imports` allows no `@12-apps/wiring`
 * import here, type-only included — this package must vendor into a repo
 * that has neither the job library nor the wiring contract. The blueprint
 * shape is the structural twin the file header describes, and the wiring
 * suite's `payments-manifest.test.ts` runs the producer assertions over this
 * value along the dependency edge that DOES exist — the jobs-manifest move,
 * one package over.
 */
export const PAYMENTS_JOBS = {
  namespace: 'payments',
  blueprints: { reconcilePending, webhookDrain, reconcileActivations, oauthRenewal },
} as const;
