import { randomUUID } from "node:crypto";

import { REFUND_ATTEMPT_DEADLINE_MS } from "@12-apps/payments-backend";

import { BillingConfigError } from "../errors";
import type { MerchantRef, NormalizedWebhookEvent } from "@12-apps/payments-backend";

import type {
  ChargeRead,
  ConfirmationPass,
  NotReturnedBy,
  NotReturnedResult,
  RefundConfirmationStore,
  RefundUpdate,
  RefundUpdateOutcome,
  SubscriptionRefundDeps,
  UnconfirmedRefund,
} from "./refund-ports";

/**
 * Following a refund the provider ACCEPTED but did not finish (FUT-4864).
 *
 * A provider can answer a refund with a PENDING snapshot — taken, to be
 * completed (Pix, commonly). The flow records it as refunded, `confirmed:
 * false`. Two things follow it:
 *
 *  - `confirmDue`, the sweep, reads the charge back. Its money back confirms
 *    the refund. Anything else is NOT evidence of a failure — Itaú keeps a Pix
 *    charge PAID while its devolução processes, PagBank reads an unknown cancel
 *    as PENDING, and an unreadable charge is an outage — so past the host's
 *    deadline the refund is only FLAGGED overdue for a person. It stays
 *    REFUNDED: settling it by hand or retrying it is refused, so the money can
 *    never be returned twice while the provider's refund may still land.
 *  - `refundUpdated`, the provider's own word (its webhook): REFUNDED confirms;
 *    FAILED — the one piece of evidence that the refund will not land —
 *    reopens it as pending, a NEW refund request (new `requestId`), so the
 *    retry series starts afresh and a person retries or settles it.
 *  - `markNotReturned`, a person's word past the deadline: reopens it the same
 *    way, but the provider's refund may still land. Its id stays on the row,
 *    so a late REFUNDED for it is ADOPTED (still pending) or recorded as a
 *    DOUBLE_RETURN (returned again meanwhile), and settling it by hand reads
 *    the charge first.
 *
 * Read-only towards the provider: nothing here sends a refund.
 */

const BATCH = 20;

/**
 * A charge that reads this has its money back. CANCELED counts only because
 * every row followed here is the refund of a PAID charge: a paid charge voided
 * returned it whole. (On a charge never paid, CANCELED would mean nothing came
 * in — never the case here.)
 */
const BACK = new Set(["REFUNDED", "CANCELED"]);

type Verdict = "CONFIRMED" | "OVERDUE" | "WAITING";

function confirmationsOf(deps: SubscriptionRefundDeps) {
  const confirmations = deps.confirmations;
  if (!confirmations) throw new BillingConfigError("confirmations", "following a refund needs a store and a confirmWithinMs");
  if (!(confirmations.confirmWithinMs > 0)) throw new BillingConfigError("confirmations.confirmWithinMs", "must be positive");
  return confirmations;
}

/**
 * Read the charge back. UNREADABLE (no charge, an outage, a timeout) is not
 * evidence either way: the sweep waits and flags; a person's act is told.
 */
export async function readCharge(
  deps: SubscriptionRefundDeps,
  charge: { provider: string | null; providerChargeId: string | null },
): Promise<ChargeRead> {
  if (!charge.provider || !charge.providerChargeId) return "UNREADABLE";
  try {
    const { gateway } = await deps.payments();
    const signal = AbortSignal.timeout(deps.attemptMs ?? REFUND_ATTEMPT_DEADLINE_MS);
    const read = await gateway.refreshCharge(deps.merchant, charge.provider, charge.providerChargeId, undefined, { signal });
    return BACK.has(read.status) ? "BACK" : "NOT_BACK";
  } catch {
    return "UNREADABLE";
  }
}

async function follow(
  deps: SubscriptionRefundDeps,
  store: RefundConfirmationStore,
  refund: UnconfirmedRefund,
  withinMs: number,
): Promise<Verdict> {
  const now = deps.now ?? (() => new Date());
  if ((await readCharge(deps, refund)) === "BACK") {
    if (await store.confirm(refund.id, now())) return "CONFIRMED";
  }
  const at = now();
  const overdue = at.getTime() - refund.refundedAt.getTime() >= withinMs;
  await store.followed(refund.id, at, overdue);
  return overdue ? "OVERDUE" : "WAITING";
}

export async function confirmDue(deps: SubscriptionRefundDeps, limit: number = BATCH): Promise<ConfirmationPass> {
  const confirmations = confirmationsOf(deps);
  const store = await confirmations.store();
  const pass: ConfirmationPass = { confirmed: 0, overdue: 0, waiting: 0, failed: 0 };
  for (const refund of await store.unconfirmed(limit)) {
    try {
      const verdict = await follow(deps, store, refund, confirmations.confirmWithinMs);
      if (verdict === "CONFIRMED") pass.confirmed += 1;
      else if (verdict === "OVERDUE") pass.overdue += 1;
      else pass.waiting += 1;
    } catch {
      // One row's write failed: the next pass reads it again; the rest go on.
      pass.failed += 1;
    }
  }
  return pass;
}

/**
 * A REFUNDED word for a refund a person said was never returned: it landed
 * after all. Still pending → recorded returned (ADOPTED), which also ends the
 * new request's series (it is owed no more). Returned again meanwhile → the
 * customer has the money twice: recorded for a person. The same word twice
 * (a redelivery) finds it settled by that very refund and is IGNORED.
 */
async function lateReturn(
  deps: SubscriptionRefundDeps,
  store: RefundConfirmationStore,
  update: RefundUpdate,
  at: Date,
): Promise<RefundUpdateOutcome> {
  const reopened = await store.findNotReturned(update.provider, update.providerChargeId, update.providerRefundId);
  if (!reopened) return "IGNORED";
  if (reopened.state === "REFUND_PENDING") {
    const payments = await deps.store();
    const record = { how: "ADOPTED" as const, providerRefundId: update.providerRefundId, refundedCents: null, confirmed: true, at };
    if (await payments.markRefunded(reopened.id, record)) return "ADOPTED";
    return "IGNORED";
  }
  // Settled by this very refund (a word, or a charge read with no second send): once.
  if (reopened.settledRefundId === update.providerRefundId) return "IGNORED";
  const recorded = await store.doubleReturned(reopened.id, { providerRefundId: update.providerRefundId, at });
  return recorded ? "DOUBLE_RETURN" : "IGNORED";
}

export async function refundUpdated(deps: SubscriptionRefundDeps, update: RefundUpdate): Promise<RefundUpdateOutcome> {
  const store = await confirmationsOf(deps).store();
  if (update.status === "PENDING") return "IGNORED";
  const at = (deps.now ?? (() => new Date()))();
  const refund = await store.findByCharge(update.provider, update.providerChargeId);
  // A word about another refund of the same charge is not this one's.
  const ours = refund !== null && (refund.providerRefundId === null || refund.providerRefundId === update.providerRefundId);
  if (!ours) return update.status === "REFUNDED" ? lateReturn(deps, store, update, at) : "IGNORED";
  if (update.status === "REFUNDED") return (await store.confirm(refund.id, at)) ? "CONFIRMED" : "IGNORED";
  const reopened = await store.reopen(refund.id, {
    reason: "REFUSED",
    message: null,
    at,
    requestId: randomUUID(),
  });
  return reopened ? "REOPENED" : "IGNORED";
}

/**
 * `refundUpdated` as a webhook event handler for ONE delivery: only a
 * REFUND_UPDATED event that carries a refund, verified against THIS binding's
 * merchant (the `merchant` argument is the one the delivery's signature was
 * checked against, never the payload's word).
 */
export function refundWebhookHandler(deps: SubscriptionRefundDeps) {
  return async (event: NormalizedWebhookEvent, _charge: unknown, merchant: MerchantRef): Promise<void> => {
    // A binding that follows no refunds has nothing to do with the word: ignored,
    // so the platform's deliveries are never failed over a missing store.
    if (!deps.confirmations) return;
    if (event.type !== "REFUND_UPDATED" || !event.refund) return;
    if (merchant.kind !== deps.merchant.kind || merchant.id !== deps.merchant.id) return;
    const { provider, providerChargeId, providerRefundId, status } = event.refund;
    await refundUpdated(deps, { provider, providerChargeId, providerRefundId, status });
  };
}

const blank = (value: string) => value.trim() === "";

export async function markNotReturned(
  deps: SubscriptionRefundDeps,
  paymentId: string,
  byHand: NotReturnedBy,
): Promise<NotReturnedResult> {
  if (blank(byHand.by) || blank(byHand.reason)) return { outcome: "NOT_REOPENED", paymentId, why: "INCOMPLETE" };
  const confirmations = confirmationsOf(deps);
  const store = await confirmations.store();
  const now = deps.now ?? (() => new Date());
  const refund = await store.findUnconfirmed(paymentId);
  if (!refund) return { outcome: "NOT_REOPENED", paymentId, why: "NOT_FOUND" };
  if (now().getTime() - refund.refundedAt.getTime() < confirmations.confirmWithinMs) {
    return { outcome: "NOT_REOPENED", paymentId, why: "NOT_OVERDUE" };
  }
  // One more read: a refund that landed meanwhile is confirmed, never reopened.
  const chargeRead = await readCharge(deps, refund);
  if (chargeRead === "BACK") {
    const confirmed = await store.confirm(refund.id, now());
    return { outcome: "NOT_REOPENED", paymentId, why: confirmed ? "MONEY_BACK" : "ALREADY_RESOLVED" };
  }
  const record = { reason: "NOT_RETURNED" as const, message: null, at: now() };
  // Conditional on the row still unconfirmed: a confirm, a provider update or
  // another person's mark that won the race leaves nothing to reopen.
  const reopened = await store.reopen(refund.id, {
    ...record,
    requestId: randomUUID(),
    byHand,
    notReturnedRefundId: refund.providerRefundId,
  });
  return reopened
    ? { outcome: "REOPENED", paymentId, record, chargeRead }
    : { outcome: "NOT_REOPENED", paymentId, why: "ALREADY_RESOLVED" };
}
