import { deliverPurchase, voidOtherAttempt } from "./purchase-deliver";
import {
  purchaseIdOf,
  type OneOffPurchaseDeps,
  type PayablePurchase,
  type PlatformChargeInput,
  type PurchaseSettleOutcome,
  type SettledPurchase,
} from "./purchase-ports";
import { createPurchaseReconcile } from "./purchase-reconcile";
import { messageOf } from "./purchase-verdict";

/**
 * Settling a purchase (FUT-5094): the webhook's path and the sweep's, one
 * function between them, so "is this payment enough, and who delivers" has a
 * single answer.
 *
 * The order is the argument:
 *
 * 1. **Not a purchase reference → `"not-mine"`**, before any read: the host's
 *    cycle settle takes it, exactly as before this existed.
 * 2. **Already settled:** by THIS charge, a replay (`"already-settled"`); by
 *    ANOTHER, the customer paid twice (`"duplicate-payment"`, logged, handed
 *    to `onDuplicatePayment`) — nothing is delivered either way.
 * 3. **A shortfall, another currency, or a currency that cannot be checked
 *    (no stored charge, no input currency) is refused BEFORE the claim.** A
 *    partial transfer must not move the row to paid; it stays payable and is
 *    logged for a person, once per charge.
 * 4. **The claim is the exactly-once point for the SETTLEMENT.** Only the
 *    caller whose conditional `claimSettled` moved the row delivers, voids
 *    the attempt still open at the provider, and reports an excess. Delivery
 *    itself is at-least-once: a throw is logged and the sweep delivers again.
 */
export function createPurchaseSettlement(deps: OneOffPurchaseDeps) {
  const now = deps.now ?? (() => new Date());
  /** Refusals already logged at error level, so a sweep does not repeat them every pass. */
  const refusalsLogged = new Set<string>();

  async function settle(input: PlatformChargeInput): Promise<PurchaseSettleOutcome> {
    const purchaseId = purchaseIdOf(input.reference);
    if (purchaseId === null) return "not-mine";
    const store = await deps.purchases();
    const row = await store.read(purchaseId);
    if (row === "unknown") {
      deps.logger.error(`purchase ${purchaseId}: charge ${input.providerChargeId} paid, but no such purchase`);
      return "unknown";
    }
    if (row.state === "settled") return settledAlready(deps, row, input);
    const refusal = await refusalOf(row, input);
    if (refusal) return refusal;

    const { currency } = row.purchase.amount;
    const settlement = { amountCents: input.amountCents, currency, providerChargeId: input.providerChargeId, paidAt: now() };
    if (!(await store.claimSettled(purchaseId, settlement))) {
      const again = await store.read(purchaseId);
      return again !== "unknown" && again.state === "settled" ? settledAlready(deps, again, input) : "already-settled";
    }
    const excessCents = input.amountCents - row.purchase.amount.amountCents;
    if (excessCents > 0) {
      deps.logger.warn(`purchase ${purchaseId}: charge ${input.providerChargeId} paid ${excessCents} past what was owed`);
    }
    await voidOtherAttempt(deps, row, input.providerChargeId);
    const settled: SettledPurchase = { state: "settled", purchase: row.purchase, settlement, delivered: false };
    return (await deliverPurchase(deps, store, settled)) ? "granted" : "delivery-pending";
  }

  /** A shortfall, a foreign or uncheckable currency — logged at error once per charge. */
  async function refusalOf(row: PayablePurchase, input: PlatformChargeInput): Promise<PurchaseSettleOutcome | null> {
    const owed = row.purchase.amount;
    const paidIn = input.currency ?? (await storedCurrency(input));
    let refusal: { outcome: PurchaseSettleOutcome; why: string } | null = null;
    if (paidIn === null) {
      // Fail CLOSED: a charge we hold no row for cannot have its currency
      // checked here. The sweep reads the provider's own word and decides.
      refusal = { outcome: "unrecognised-charge", why: `has no stored charge under ${input.reference}; left to the sweep` };
    } else if (paidIn !== owed.currency) {
      refusal = { outcome: "currency-mismatch", why: `paid in ${paidIn}, owed in ${owed.currency}` };
    } else if (input.amountCents < owed.amountCents) {
      refusal = { outcome: "shortfall", why: `captured ${input.amountCents}, short of ${owed.amountCents}` };
    }
    if (!refusal) return null;
    const key = `${row.purchase.id}:${input.providerChargeId}`;
    const line = `purchase ${row.purchase.id}: charge ${input.providerChargeId} ${refusal.why}; not settled`;
    if (refusalsLogged.has(key)) deps.logger.warn(line);
    else deps.logger.error(line);
    refusalsLogged.add(key);
    return refusal.outcome;
  }

  /** The stored charge's currency — a purchase charge's idempotency key IS its reference. */
  async function storedCurrency(input: PlatformChargeInput): Promise<string | null> {
    const stored = await deps.charges.findByIdempotencyKey(deps.merchant, input.reference);
    return stored ? stored.snapshot.amount.currency : null;
  }

  return { settle, reconcileDue: createPurchaseReconcile(deps, settle, now) };
}

/** A confirmation for a purchase already settled: a replay, or a second payment. */
async function settledAlready(
  deps: OneOffPurchaseDeps,
  row: SettledPurchase,
  input: PlatformChargeInput,
): Promise<PurchaseSettleOutcome> {
  if (row.settlement.providerChargeId === input.providerChargeId) return "already-settled";
  deps.logger.error(
    `purchase ${row.purchase.id}: settled by ${row.settlement.providerChargeId}, PAID AGAIN by ${input.providerChargeId} (${input.amountCents}); nothing delivered`,
  );
  try {
    await deps.onDuplicatePayment?.(row.purchase, { amountCents: input.amountCents, providerChargeId: input.providerChargeId });
  } catch (error) {
    // The outcome stands: a webhook handler that threw would only be replayed into the same answer.
    deps.logger.error(`purchase ${row.purchase.id}: onDuplicatePayment threw for ${input.providerChargeId}: ${messageOf(error)}`);
  }
  return "duplicate-payment";
}
