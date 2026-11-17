import {
  createCycleCollector,
  type CollectionResult,
  type CycleStore,
  type RaisedCharge,
} from "@12-apps/payments-backend";

import {
  purchaseReference,
  type OneOffPurchase,
  type OneOffPurchaseDeps,
  type PayablePurchase,
  type PurchaseCardOptions,
  type PurchaseStore,
} from "./purchase-ports";
import { createPurchaseSettlement } from "./purchase-settle";

/**
 * ONE-OFF PURCHASES (FUT-5094) — something a customer buys from the platform
 * once, paid IN ADVANCE, delivered by the host only once the payment is
 * CONFIRMED.
 *
 * ## The same plumbing as a cycle, on purpose
 *
 * A purchase is raised through payments-backend's `createCycleCollector`, the
 * very flow `createSubscriptionCollection` binds: the platform merchant, the
 * deployment guard, the instrument lookup at the provider collecting today,
 * the merchant-initiated card flag, the idempotent raise, and the rule that a
 * DECLINED card records nothing. Only the store differs — the purchase row is
 * presented to the collector as a cycle whose id is the attempt's reference.
 *
 * ## The reference says whose charge it is
 *
 * Every purchase charge is raised under `purchase:<id>` (`--<n>` from the
 * second attempt on). The webhook reactor hands every PLATFORM payment to the
 * host's one `settlePlatformPayment`; the host asks `settlePlatformCharge`
 * first, and only its `"not-mine"` reaches the cycle settle. The dispatch is
 * a prefix this package owns, not a guess about an id's shape.
 *
 * ## A retry is a fresh charge
 *
 * The reference is also the idempotency key, and the gateway answers a known
 * key with the charge already stored under it. So a failed attempt (a card
 * refused, a code lapsed) advances the row's `attempt`, and the retry is
 * raised under the next reference — never the old charge handed back.
 *
 * Server-only.
 */
export function createOneOffPurchase(deps: OneOffPurchaseDeps): OneOffPurchase {
  const settlement = createPurchaseSettlement(deps);

  /** The collector over ONE purchase row, already read. */
  async function collectorFor(store: PurchaseStore, purchaseId: string, row: Row) {
    const { credentials, gateway } = await deps.payments();
    const view = cycleView(store, purchaseId, row);
    const collector = createCycleCollector({
      gateway,
      credentials,
      cycles: view.store,
      instruments: deps.instruments,
      merchant: deps.merchant,
      enabled: deps.enabled,
    });
    return { collector, view, reference: view.reference };
  }

  async function open(purchaseId: string) {
    const store = await deps.purchases();
    const refused = refusable(purchaseId);
    if (refused) deps.logger.error(`purchase id ${JSON.stringify(purchaseId)} cannot carry a charge reference`);
    const row: Row = refused ? "unknown" : await store.read(purchaseId);
    return { store, row, ...(await collectorFor(store, purchaseId, row)) };
  }

  return {
    async startByPush(purchaseId) {
      const { collector, view, reference } = await open(purchaseId);
      const result = await collector.collectByPush(reference);
      await view.persist(result);
      return result;
    },

    async startByCard(purchaseId, options: PurchaseCardOptions = {}) {
      const { store, row, collector, view, reference } = await open(purchaseId);
      const card = options.cardholderPresent === undefined ? {} : { cardholderPresent: options.cardholderPresent };
      const result = await collector.collectByCard(reference, card);
      await view.persist(result);
      await afterCard(store, purchaseId, row, reference, result);
      return result;
    },

    settlePlatformCharge: settlement.settle,
    reconcileDue: settlement.reconcileDue,
  };

  /** A refused card fails the attempt; a PAID one settles now rather than waiting on a webhook. */
  async function afterCard(
    store: PurchaseStore,
    purchaseId: string,
    row: Row,
    reference: string,
    result: CollectionResult,
  ): Promise<void> {
    const snapshot = result.snapshot;
    if (!snapshot || typeof row === "string") return;
    if (snapshot.status === "DECLINED") {
      const declined = snapshot.declineReason ? { declineReason: snapshot.declineReason } : {};
      await store.markFailed(purchaseId, {
        attempt: row.attempt,
        providerChargeId: snapshot.providerChargeId,
        reason: "DECLINED",
        ...declined,
      });
      return;
    }
    if (snapshot.status === "PAID") {
      await settlement.settle({
        reference,
        amountCents: snapshot.amount.amountCents,
        providerChargeId: snapshot.providerChargeId,
      });
    }
  }
}

type Row = PayablePurchase | "unknown" | "settled";

/** An id the attempt convention cannot carry: empty, or holding its separator. */
function refusable(purchaseId: string): boolean {
  return purchaseId.length === 0 || purchaseId.includes("--");
}

/**
 * The purchase row as the collector's `CycleStore`: the cycle id is the
 * current attempt's reference, and `recordRaised` is held until the snapshot
 * is back, so the host is told the code's expiry along with the charge.
 */
function cycleView(store: PurchaseStore, purchaseId: string, row: Row) {
  const attempt = typeof row === "string" ? 0 : row.attempt;
  const reference = purchaseReference(purchaseId, attempt);
  let raised: RaisedCharge | null = null;
  const view: CycleStore = {
    async read() {
      if (typeof row === "string") return row;
      const { groupId, amount, customer } = row.purchase;
      return { cycle: { id: reference, groupId, amount, customer }, providerChargeId: row.providerChargeId };
    },
    async recordRaised(_reference, charge) {
      raised = charge;
    },
  };
  return {
    reference,
    store: view,
    async persist(result: CollectionResult): Promise<void> {
      if (!raised) return;
      const expires = result.snapshot?.pix?.expiresAt;
      const expiresAt = expires && !Number.isNaN(Date.parse(expires)) ? new Date(expires) : null;
      await store.recordRaised(purchaseId, {
        attempt,
        reference,
        provider: raised.provider,
        providerChargeId: raised.providerChargeId,
        method: raised.method,
        expiresAt,
      });
    },
  };
}
