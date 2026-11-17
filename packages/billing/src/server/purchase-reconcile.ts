import type { ChargeSnapshot } from "@12-apps/payments-backend";

import { deliverPurchase } from "./purchase-deliver";
import {
  purchaseReference,
  type OneOffPurchaseDeps,
  type PlatformChargeInput,
  type PurchaseReconcilePass,
  type PurchaseSettleOutcome,
  type PurchaseStore,
  type UnansweredPurchaseCharge,
} from "./purchase-ports";
import { failureOf, messageOf } from "./purchase-verdict";

/**
 * The purchase sweep (FUT-5094): ask the provider about every charge nobody
 * answered — paid settles through the webhook's own `settle`; refused,
 * lapsed or refunded fails the attempt — then deliver every settled purchase
 * whose `onSettled` has not yet returned.
 */
export function createPurchaseReconcile(
  deps: OneOffPurchaseDeps,
  settle: (input: PlatformChargeInput) => Promise<PurchaseSettleOutcome>,
  now: () => Date,
): (at?: Date) => Promise<PurchaseReconcilePass> {
  async function reconcileDue(at: Date = now()): Promise<PurchaseReconcilePass> {
    const pass: PurchaseReconcilePass = { settled: 0, failed: 0, stillPending: 0, unreadable: 0, delivered: 0, undelivered: 0 };
    if (!(await deps.enabled())) return pass;
    const store = await deps.purchases();
    const { gateway } = await deps.payments();
    for (const open of await store.unanswered()) {
      let snapshot: ChargeSnapshot;
      try {
        snapshot = await gateway.refreshCharge(deps.merchant, open.provider, open.providerChargeId);
      } catch (error) {
        deps.logger.warn(`purchase ${open.purchaseId}: charge ${open.providerChargeId} unreadable: ${messageOf(error)}`);
        pass.unreadable += 1;
        continue;
      }
      pass[await answer(store, open, snapshot, at)] += 1;
    }
    for (const row of await store.undelivered()) {
      pass[(await deliverPurchase(deps, store, row)) ? "delivered" : "undelivered"] += 1;
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
        currency: snapshot.amount.currency,
        providerChargeId: open.providerChargeId,
      });
      return SETTLED_OUTCOMES.has(outcome) ? "settled" : "stillPending";
    }
    const reason = failureOf(snapshot, open, at);
    if (!reason) return "stillPending";
    const failure = { attempt: open.attempt, providerChargeId: open.providerChargeId, reason };
    const declined = snapshot.declineReason ? { declineReason: snapshot.declineReason } : {};
    const written = await store.markFailed(open.purchaseId, { ...failure, ...declined });
    if (written && (snapshot.status === "REFUNDED" || snapshot.status === "PARTIALLY_REFUNDED")) {
      deps.logger.error(
        `purchase ${open.purchaseId}: charge ${open.providerChargeId} was ${snapshot.status} before it settled; attempt failed`,
      );
    }
    return "failed";
  }

  return reconcileDue;
}

const SETTLED_OUTCOMES: ReadonlySet<PurchaseSettleOutcome> = new Set([
  "granted",
  "delivery-pending",
  "already-settled",
  "duplicate-payment",
]);
