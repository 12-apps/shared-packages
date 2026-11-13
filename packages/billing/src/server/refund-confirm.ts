import { randomUUID } from "node:crypto";

import { REFUND_ATTEMPT_DEADLINE_MS } from "@12-apps/payments-backend";

import { BillingConfigError } from "../errors";
import type {
  ConfirmationPass,
  RefundConfirmationStore,
  RefundUpdate,
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

/** The charge's money is back: true; not (yet) or unreadable: false. */
async function moneyBack(deps: SubscriptionRefundDeps, refund: UnconfirmedRefund): Promise<boolean> {
  if (!refund.provider || !refund.providerChargeId) return false;
  try {
    const { gateway } = await deps.payments();
    const signal = AbortSignal.timeout(deps.attemptMs ?? REFUND_ATTEMPT_DEADLINE_MS);
    const charge = await gateway.refreshCharge(deps.merchant, refund.provider, refund.providerChargeId, undefined, { signal });
    return BACK.has(charge.status);
  } catch {
    // Unreadable is not evidence either way: it waits, then is flagged.
    return false;
  }
}

async function follow(
  deps: SubscriptionRefundDeps,
  store: RefundConfirmationStore,
  refund: UnconfirmedRefund,
  withinMs: number,
): Promise<Verdict> {
  const now = deps.now ?? (() => new Date());
  if (await moneyBack(deps, refund)) {
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

export async function refundUpdated(
  deps: SubscriptionRefundDeps,
  update: RefundUpdate,
): Promise<"CONFIRMED" | "REOPENED" | "IGNORED"> {
  const store = await confirmationsOf(deps).store();
  if (update.status === "PENDING") return "IGNORED";
  const refund = await store.findByCharge(update.provider, update.providerChargeId);
  if (!refund) return "IGNORED";
  // A word about another refund of the same charge is not this one's.
  if (refund.providerRefundId !== null && refund.providerRefundId !== update.providerRefundId) return "IGNORED";
  const at = (deps.now ?? (() => new Date()))();
  if (update.status === "REFUNDED") return (await store.confirm(refund.id, at)) ? "CONFIRMED" : "IGNORED";
  const reopened = await store.reopen(refund.id, {
    reason: "REFUSED",
    message: null,
    at,
    requestId: randomUUID(),
  });
  return reopened ? "REOPENED" : "IGNORED";
}
