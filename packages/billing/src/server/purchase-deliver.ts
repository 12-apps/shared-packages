import type { OneOffPurchaseDeps, PayablePurchase, PurchaseStore, SettledPurchase } from "./purchase-ports";
import { messageOf } from "./purchase-verdict";

/**
 * Delivering a settled purchase (FUT-5094) — AT-LEAST-ONCE.
 *
 * `onSettled` runs first for the caller whose claim won, and again from the
 * sweep for every row `undelivered()` still lists. A throw is logged and
 * answered `false`, never rethrown: the payment is settled whatever delivery
 * does, and a caller that saw a throw (a card charged at the screen) would
 * read a paid purchase as a failed one. The host's `onSettled` is idempotent
 * by purchase id; that contract is what makes "again" safe.
 */
export async function deliverPurchase(
  deps: OneOffPurchaseDeps,
  store: PurchaseStore,
  row: SettledPurchase,
): Promise<boolean> {
  const { purchase, settlement } = row;
  const excessCents = settlement.amountCents - purchase.amount.amountCents;
  try {
    await deps.onSettled(purchase, { ...settlement, excessCents });
  } catch (error) {
    deps.logger.error(`purchase ${purchase.id}: settled by ${settlement.providerChargeId}, delivery threw: ${messageOf(error)}`);
    return false;
  }
  try {
    await store.markDelivered(purchase.id);
  } catch (error) {
    // Delivered, but not recorded: the sweep delivers again, which an idempotent `onSettled` absorbs.
    deps.logger.error(`purchase ${purchase.id}: delivered, but markDelivered threw: ${messageOf(error)}`);
    return false;
  }
  return true;
}

/**
 * Once settled, void the OTHER attempt's charge still open at the provider —
 * best-effort, logged. A code left payable can be paid a second time, which
 * then arrives as a duplicate payment; voiding it closes most of that window.
 */
export async function voidOtherAttempt(
  deps: OneOffPurchaseDeps,
  row: PayablePurchase,
  settledBy: string,
): Promise<void> {
  const { providerChargeId, provider } = row;
  if (!providerChargeId || !provider || providerChargeId === settledBy) return;
  try {
    const { gateway } = await deps.payments();
    await gateway.cancelCharge(deps.merchant, provider, providerChargeId);
  } catch (error) {
    deps.logger.warn(
      `purchase ${row.purchase.id}: settled by ${settledBy}; could not void open charge ${providerChargeId}: ${messageOf(error)}`,
    );
  }
}
