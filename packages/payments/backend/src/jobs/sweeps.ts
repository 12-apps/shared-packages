/**
 * The three sweeps that moved in from the origin host.
 *
 * Split from `./index` at the 400-line gate, on the seam the file already had:
 * `index.ts` is the DECLARATION — the deps a host binds, the cadence constants
 * and the exported set — and this is the work each blueprint does. The
 * reconciliation sweep stays over there because its handler is four lines over
 * a core function; these three each carry a policy the host used to restate.
 *
 * Nothing here imports a host or a job library — see `./index`'s header for
 * why this package must vendor into a repo that has neither.
 */

import { reconcileActivationCharges } from '../activation/reconcile';
import type { ActivationReport } from '../activation/reconcile';

import {
  ACTIVATION_RECONCILE_CRON,
  OAUTH_RENEWAL_BATCH,
  OAUTH_RENEWAL_CRON,
  OAUTH_RENEW_WITHIN_MS,
  PAYMENTS_SWEEP_QUEUE,
  WEBHOOK_DRAIN_CRON,
} from './cadence';
// Type-only, so this stays a leaf at RUNTIME — the cycle that made every
// cadence `undefined` is exactly what a value import back into `./index`
// would recreate.
import type { PaymentsJobBlueprint } from './index';

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
export const webhookDrain: PaymentsJobBlueprint = {
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
    // Counts only, never content: the payload is the provider's own data about
    // a buyer and the headers carry the delivery's signature, so neither may
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
 * No provider call is made: the pass joins the config's outstanding charge
 * against the charge row the verified webhook already wrote, which is why its
 * lease is the short one.
 */
export const reconcileActivations: PaymentsJobBlueprint = {
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
 * once, and the only way back is the owner reauthorizing on the provider's
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
 * first's tokens and BOTH believe they succeeded. Concurrency 1 on the sweep
 * queue bounds one process; the lease bounds all of them. Neither is tuning,
 * and a host that restates them by hand is a host that can get them wrong.
 */
export const oauthRenewal: PaymentsJobBlueprint = {
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
