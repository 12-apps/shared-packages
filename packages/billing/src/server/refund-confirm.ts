import { REFUND_ATTEMPT_DEADLINE_MS } from "@12-apps/payments-backend";

import { BillingConfigError } from "../errors";
import type { ConfirmationPass, SubscriptionRefundDeps, UnconfirmedRefund } from "./refund-ports";

/**
 * Following a refund the provider ACCEPTED but did not finish (FUT-4864).
 *
 * A provider can answer a refund with a PENDING snapshot — taken, to be
 * completed (Pix, commonly). The flow records it as refunded, `confirmed:
 * false`, because the money is the provider's to return and nobody should be
 * asked to settle it. This pass is what makes that safe: it consults the
 * charge, the same read the retrier consults before a resend.
 *
 *  - The charge reads REFUNDED (or CANCELED, a whole charge voided): the refund
 *    is confirmed.
 *  - Still not back once the host's `confirmWithinMs` passed since it was
 *    recorded — or no answer by then: the refund is REOPENED as pending
 *    (`NOT_CONFIRMED`), asked for again now, so a person retries it (the retry
 *    consults the charge first) or settles it by hand.
 *  - Inside the deadline: it waits for the next pass.
 *
 * Read-only towards the provider: nothing here sends a refund.
 */

const BATCH = 20;

/** A charge that reads this has its money back: a refund, or the whole charge voided. */
const BACK = new Set(["REFUNDED", "CANCELED"]);

type Verdict = "CONFIRMED" | "REOPENED" | "WAITING";

/** The confirmation deadline has passed for this refund. */
const overdue = (refund: UnconfirmedRefund, now: Date, withinMs: number): boolean =>
  now.getTime() - refund.refundedAt.getTime() >= withinMs;

function messageOf(error: unknown): string | null {
  if (!(error instanceof Error) || error.message.trim() === "") return null;
  return error.message.trim().slice(0, 500);
}

export async function confirmDue(deps: SubscriptionRefundDeps, limit: number = BATCH): Promise<ConfirmationPass> {
  const confirmations = deps.confirmations;
  if (!confirmations) throw new BillingConfigError("confirmations", "confirmDue needs a store and a confirmWithinMs");
  if (!(confirmations.confirmWithinMs > 0)) throw new BillingConfigError("confirmations.confirmWithinMs", "must be positive");
  const now = deps.now ?? (() => new Date());
  const withinMs = confirmations.confirmWithinMs;
  const store = await confirmations.store();
  const rows = await store.unconfirmed(limit);
  const pass: ConfirmationPass = { confirmed: 0, reopened: 0, waiting: 0 };
  if (rows.length === 0) return pass;
  const { gateway } = await deps.payments();

  async function reopen(refund: UnconfirmedRefund, message: string | null): Promise<Verdict> {
    const wrote = await store.reopen(refund.id, { reason: "NOT_CONFIRMED", message, at: now() });
    return wrote ? "REOPENED" : "WAITING";
  }

  /** The charge's status, or the error that kept it from being read; null with no charge to read. */
  async function chargeOf(refund: UnconfirmedRefund): Promise<{ status: string } | { error: unknown } | null> {
    if (!refund.provider || !refund.providerChargeId) return null;
    try {
      const signal = AbortSignal.timeout(deps.attemptMs ?? REFUND_ATTEMPT_DEADLINE_MS);
      const charge = await gateway.refreshCharge(deps.merchant, refund.provider, refund.providerChargeId, undefined, { signal });
      return { status: charge.status };
    } catch (error) {
      return { error };
    }
  }

  async function verdictOf(refund: UnconfirmedRefund): Promise<Verdict> {
    const charge = await chargeOf(refund);
    if (charge && "status" in charge && BACK.has(charge.status)) {
      return (await store.confirm(refund.id, now())) ? "CONFIRMED" : "WAITING";
    }
    if (!overdue(refund, now(), withinMs)) return "WAITING";
    return reopen(refund, charge && "error" in charge ? messageOf(charge.error) : null);
  }

  for (const refund of rows) {
    const verdict = await verdictOf(refund);
    if (verdict === "CONFIRMED") pass.confirmed += 1;
    else if (verdict === "REOPENED") pass.reopened += 1;
    else pass.waiting += 1;
  }
  return pass;
}
