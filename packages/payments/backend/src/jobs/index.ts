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
import { reconcileActivationCharges } from '../activation/reconcile';
import type { WebhookReplayOptions, WebhookReplayReport } from '../core/webhook-replay';
import type { ExpiringConnection, ProviderConfigStore, StoredProviderConfig } from '../config/types';
import type { MerchantRef, ProviderName } from '../core/types';
import type {
  ActivationReconcileContext,
  ActivationReport,
} from '../activation/reconcile';

/**
 * What the host supplies once, when it binds these blueprints.
 *
 * Deliberately the SAME shape `reconcilePendingCharges` already takes: the
 * store, a gateway that can re-read a charge, and the host's own idempotent
 * settle path. Nothing new to implement for a host that had already wired the
 * sweep by hand — it deletes its scheduling and passes the same object.
 */
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
 * The single-flight queue name. Stated as a literal rather than imported for
 * the reason in the header; it is the same string `@12-apps/jobs` exports as
 * `SWEEP_QUEUE`, and `paymentsJobBlueprints.test.ts` pins the pair.
 */
export const PAYMENTS_SWEEP_QUEUE = 'sweeps';

/** Five minutes — the resolution at which "paid but still pending" is a delay. */
export const RECONCILE_CRON = '*/5 * * * *';

/** Same five minutes, same reason: an unsettled delivery is a delay, not news. */
export const WEBHOOK_DRAIN_CRON = '*/5 * * * *';

/** And again: an activation whose proof never landed is the same class of wait. */
export const ACTIVATION_RECONCILE_CRON = '*/5 * * * *';

/**
 * Hourly. The renewal window below is measured in weeks, so this only decides
 * how fast a transient provider outage is retried.
 */
export const OAUTH_RENEWAL_CRON = '0 * * * *';

/**
 * How far ahead to renew a grant.
 *
 * Generous on purpose. Renewing early costs one request against a grant that
 * had months left; renewing late costs a merchant that cannot take money until
 * a human notices. Against an observed lifetime near a year, a fortnight of
 * runway is a rounding error and still leaves room for a dozen failed attempts.
 */
export const OAUTH_RENEW_WITHIN_MS = 14 * 24 * 60 * 60_000;

/**
 * Connections per tick. Renewal is one outbound call each and the pass holds a
 * lease while it runs, so this bounds how long one tick can hold that lease
 * rather than throughput: whatever is left is picked up an hour later, still
 * far inside the window above.
 */
export const OAUTH_RENEWAL_BATCH = 100;

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

/**
 * Finish the webhook deliveries nothing else will.
 *
 * `PaymentWebhookEvent` has always been a transactional inbox: the delivery is
 * committed BEFORE any of it is applied. What never shipped was the process
 * that comes back for a row that did not settle, and two shapes of row wait for
 * it — FAILED (the apply threw) and, strictly worse, PENDING (the process died
 * between the inbox write and settling it, so the provider already has its 2xx
 * and will never redeliver; the row is the only surviving evidence a buyer
 * paid).
 *
 * Five minutes, because that is the resolution at which "the buyer paid but the
 * order still says pending" stays a delay instead of becoming an incident.
 *
 * Single-flight is not tuning. The sweep decides "has this row already been
 * applied?" by re-recording it, so two passes interleaved on one row would both
 * read the pre-apply answer. The pipeline absorbs that — the inbox dedup key
 * and the monotonic charge upsert land a duplicate apply on the same row — but
 * a job that runs twelve times an hour and is never latency-sensitive has
 * nothing to buy by leaning on it.
 *
 * The batch bound and the attempt cap are deliberately NOT restated at the
 * cadence: they only mean anything against the backoff curve they are paired
 * with, which `webhook-replay` owns, and a second copy is a second policy that
 * drifts.
 */
const webhookDrain: PaymentsJobBlueprint = {
  name: 'webhook-drain',
  queue: PAYMENTS_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: WEBHOOK_DRAIN_CRON },
  // No retry: the next pass IS the retry, five minutes out. A pass that died
  // half-way left every row it settled settled and every row it did not exactly
  // as it was, so re-running is free of consequence — and retrying immediately
  // would hammer a database or an order-confirmation path that has just
  // demonstrated it is unwell.
  attempts: 1,
  // The longest of the four: this pass re-VERIFIES each row against the
  // provider, which for an unsigned provider is an outbound call per delivery.
  // A ttl that lapsed mid-pass would let a second worker replay rows this one
  // is still working.
  lease: { ttlMs: 20 * 60_000 },
  handle: async (_payload, deps, context) => {
    const report = await deps.replayWebhooks({ now: (deps.now ?? (() => new Date()))() });
    // Counts only, never content: the payload is the provider\'s own data about
    // a buyer and the headers carry the delivery\'s signature, so neither may
    // reach a log. The per-row detail support wants is already durable in
    // `PaymentWebhookEvent.lastError`.
    //
    // `undecodable` breaks the silence on its own: a pass whose whole batch was
    // rows we cannot rehydrate attempts nothing, and staying quiet would report
    // a healthy sweep doing no work while each of those rows may be a paid
    // order nobody can reconstruct.
    if (report.attempted === 0 && report.undecodable === 0) return;
    const undecodable =
      report.undecodable > 0 ? ` ${report.undecodable} could not be decoded.` : '';
    context.logger.info(
      `[payments] webhook-drain replayed ${report.attempted}: ${report.processed} applied, ` +
        `${report.failed} still failing, ${report.skipped} already settled.${undecodable}`,
    );
  },
};

/**
 * Stamp activation charges that paid without their proof landing.
 *
 * The drain above finishes deliveries that ARRIVED; this repairs the ones whose
 * proof never did. Nothing else comes back for these rows — webhook redelivery
 * included, because the inbox remembers that delivery as settled.
 *
 * No provider call is made: the pass joins the config\'s outstanding charge
 * against the charge row the verified webhook already wrote, which is why its
 * lease is the short one.
 */
const reconcileActivations: PaymentsJobBlueprint = {
  name: 'reconcile-activations',
  queue: PAYMENTS_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: ACTIVATION_RECONCILE_CRON },
  // Same reasoning as the sweeps above: the next pass IS the retry.
  attempts: 1,
  lease: { ttlMs: 5 * 60_000 },
  handle: async (_payload, deps, context) => {
    const report: ActivationReport = await reconcileActivationCharges(deps.activation);
    // Silent when nothing is outstanding — that is the steady state.
    if (report.checked === 0) return;
    context.logger.info(
      `[payments] reconcile-activations checked ${report.checked}: ${report.stamped} stamped`,
    );
  },
};

/**
 * Renew OAuth grants before they lapse.
 *
 * The failure this prevents does not degrade. A lapsed grant does not slow
 * checkout down or fail one shopper: every charge for that merchant stops at
 * once, and the only way back is the owner reauthorizing on the provider\'s
 * site. Providers publish no lifetime, and an observed connection carried
 * roughly a year — long enough that nobody would be watching when it ran out.
 *
 * Hourly. The renewal window is measured in WEEKS, so the cadence only decides
 * how quickly a transient provider outage is retried: an hour is far below the
 * runway and far above anything that could be called polling.
 *
 * SINGLE-FLIGHT MATTERS HERE MORE THAN FOR THE OTHER SWEEPS, and this is the
 * rule that used to live in a host comment. Renewal ROTATES: the provider
 * issues a new refresh token and kills the one just spent, so two ticks
 * overlapping on one connection means the second response invalidates the
 * first\'s tokens and BOTH believe they succeeded. Concurrency 1 on the sweep
 * queue bounds one process; the lease bounds all of them. Neither is tuning,
 * and a host that restates them by hand is a host that can get them wrong.
 */
const oauthRenewal: PaymentsJobBlueprint = {
  name: 'oauth-renewal',
  queue: PAYMENTS_SWEEP_QUEUE,
  concurrency: 1,
  schedule: { pattern: OAUTH_RENEWAL_CRON },
  // No retry: the next tick IS the retry, an hour out and still weeks inside
  // the window. Retrying immediately would re-present a refresh token the
  // provider may have just rotated — the one thing that turns a failed renewal
  // into a lost connection.
  attempts: 1,
  // Long enough for a full batch of outbound renewals, not so long that a dead
  // worker blocks the next tick for hours.
  lease: { ttlMs: 10 * 60_000 },
  handle: async (_payload, deps, context) => {
    const now = (deps.now ?? (() => new Date()))();
    const due = await deps.oauth.listExpiring(
      new Date(now.getTime() + OAUTH_RENEW_WITHIN_MS),
      OAUTH_RENEWAL_BATCH,
    );
    if (due.length === 0) return;

    let renewed = 0;
    let needsReconnect = 0;
    let lost = 0;

    for (const connection of due) {
      try {
        const result = await deps.oauth.refresh(connection.merchant, connection.provider);
        if (result.status === 'RECONNECT_REQUIRED') {
          needsReconnect += 1;
          context.logger.warn(
            `[payments] ${connection.provider} grant for ${connection.merchant.id} could not be ` +
              `renewed; the merchant must reauthorize (expires ${connection.expiresAt.toISOString()})`,
          );
          // The warn reaches an operator; this reaches the one person who can
          // actually fix it.
          deps.oauth.onReconnectRequired?.(connection, 'refused');
          continue;
        }
        renewed += 1;
      } catch (error) {
        // The one outcome worse than a failed renewal: the provider rotated and
        // we could not keep what it returned, so the tokens that still work
        // exist nowhere. Loud, because the merchant is down until the owner
        // reauthorizes and nothing else will say so.
        lost += 1;
        context.logger.error(
          `[payments] ${connection.provider} renewal for ${connection.merchant.id} left the ` +
            `connection unusable: ${error instanceof Error ? error.message : String(error)}`,
        );
        deps.oauth.onReconnectRequired?.(connection, 'lost');
      }
    }

    context.logger.info(
      `[payments] oauth-renewal: ${renewed}/${due.length} renewed, ` +
        `${needsReconnect} need reauthorization, ${lost} lost`,
    );
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
