import { chargeDeadlinePassed, type ChargeSnapshot } from "@12-apps/payments-backend";

import {
  purchaseIdOf,
  purchaseReference,
  type OneOffPurchaseDeps,
  type PlatformChargeInput,
  type PurchaseReconcilePass,
  type PurchaseSettleOutcome,
  type PurchaseStore,
  type UnansweredPurchaseCharge,
} from "./purchase-ports";

/**
 * Settling a purchase (FUT-5094): the webhook's path and the sweep's, one
 * function between them, so "is this payment enough, and who delivers" has a
 * single answer.
 *
 * The order is the argument:
 *
 * 1. **Not a purchase reference → `"not-mine"`**, before any read: the host's
 *    cycle settle takes it, exactly as before this existed.
 * 2. **A shortfall is refused BEFORE the claim.** A partial transfer must not
 *    move the row to paid, or the purchase is delivered for less than it
 *    costs; it stays payable and is logged for a person.
 * 3. **The claim is the exactly-once point.** Only the caller whose
 *    conditional `claimSettled` moved the row delivers; a replay, a racing
 *    sweep or a second payment loses it and delivers nothing.
 * 4. **An overpayment settles**, delivers the purchase — never more — and is
 *    reported (`excessCents`, and a warning) for the host to return or keep.
 */
export function createPurchaseSettlement(deps: OneOffPurchaseDeps) {
  const now = deps.now ?? (() => new Date());

  async function settle(input: PlatformChargeInput): Promise<PurchaseSettleOutcome> {
    const purchaseId = purchaseIdOf(input.reference);
    if (purchaseId === null) return "not-mine";
    const store = await deps.purchases();
    const row = await store.read(purchaseId);
    if (row === "unknown") {
      deps.logger.error(`purchase ${purchaseId}: charge ${input.providerChargeId} paid, but no such purchase`);
      return "unknown";
    }
    if (row === "settled") return alreadySettled(deps, purchaseId, input);
    const owed = row.purchase.amount.amountCents;
    if (input.amountCents < owed) {
      deps.logger.error(
        `purchase ${purchaseId}: charge ${input.providerChargeId} captured ${input.amountCents}, short of ${owed}; not settled`,
      );
      return "shortfall";
    }
    const settlement = { amountCents: input.amountCents, providerChargeId: input.providerChargeId, paidAt: now() };
    if (!(await store.claimSettled(purchaseId, settlement))) return alreadySettled(deps, purchaseId, input);
    const excessCents = input.amountCents - owed;
    if (excessCents > 0) {
      deps.logger.warn(`purchase ${purchaseId}: charge ${input.providerChargeId} paid ${excessCents} past what was owed`);
    }
    try {
      await deps.onSettled(row.purchase, { ...settlement, excessCents });
    } catch (error) {
      deps.logger.error(`purchase ${purchaseId}: settled by ${input.providerChargeId}, but delivering it threw`);
      throw error;
    }
    return "granted";
  }

  async function reconcileDue(at: Date = now()): Promise<PurchaseReconcilePass> {
    const pass: PurchaseReconcilePass = { settled: 0, failed: 0, stillPending: 0, unreadable: 0 };
    if (!(await deps.enabled())) return pass;
    const store = await deps.purchases();
    const { gateway } = await deps.payments();
    for (const open of await store.unanswered()) {
      let snapshot: ChargeSnapshot;
      try {
        snapshot = await gateway.refreshCharge(deps.merchant, open.provider, open.providerChargeId);
      } catch {
        pass.unreadable += 1;
        continue;
      }
      pass[await answer(store, open, snapshot, at)] += 1;
    }
    return pass;
  }

  /** What the provider's word on one unanswered charge does. */
  async function answer(
    store: PurchaseStore,
    open: UnansweredPurchaseCharge,
    snapshot: ChargeSnapshot,
    at: Date,
  ): Promise<"settled" | "failed" | "stillPending"> {
    if (snapshot.status === "PAID") {
      const outcome = await settle({
        reference: purchaseReference(open.purchaseId, open.attempt),
        amountCents: snapshot.amount.amountCents,
        providerChargeId: open.providerChargeId,
      });
      return outcome === "granted" || outcome === "already-settled" ? "settled" : "stillPending";
    }
    const reason = failureOf(snapshot, open, at);
    if (!reason) return "stillPending";
    const failure = { attempt: open.attempt, providerChargeId: open.providerChargeId, reason };
    const declined = snapshot.declineReason ? { declineReason: snapshot.declineReason } : {};
    await store.markFailed(open.purchaseId, { ...failure, ...declined });
    return "failed";
  }

  return { settle, reconcileDue };
}

function alreadySettled(deps: OneOffPurchaseDeps, purchaseId: string, input: PlatformChargeInput): PurchaseSettleOutcome {
  // A replay of the settling charge reads the same as a second payment here;
  // the host's claim knows which charge settled it, and says.
  deps.logger.warn(`purchase ${purchaseId}: already settled; charge ${input.providerChargeId} delivered nothing`);
  return "already-settled";
}

/**
 * The provider's refusal or lapse, or null while the charge can still be paid.
 * A pending push code fails only once its deadline has passed — the
 * provider's own deadline first, the one recorded at the raise otherwise.
 */
function failureOf(
  snapshot: ChargeSnapshot,
  open: UnansweredPurchaseCharge,
  at: Date,
): "DECLINED" | "EXPIRED" | "CANCELED" | null {
  switch (snapshot.status) {
    case "DECLINED":
      return "DECLINED";
    case "CANCELED":
      return "CANCELED";
    case "EXPIRED":
      return "EXPIRED";
    case "PENDING":
    case "AUTHORIZED": {
      const deadline = snapshot.pix?.expiresAt ?? open.expiresAt?.toISOString();
      return chargeDeadlinePassed(deadline, at.getTime()) ? "EXPIRED" : null;
    }
    default:
      // REFUNDED / PARTIALLY_REFUNDED: money moved and came back; a person's.
      return null;
  }
}
