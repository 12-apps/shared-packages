import { isTerminal } from './status';
import type { ChargeSnapshot } from './types';

/**
 * What a re-read of a charge is allowed to CHANGE about the stored one.
 *
 * A refresh answers ONE question — what has happened to this charge since —
 * and `upsertByProviderChargeId` used to treat the answer as a whole new
 * charge, storing it verbatim over the row creation had written. Those are not
 * the same object. `createCharge` knows what was asked for and what the
 * provider minted; `getCharge` knows only what the provider will say about an
 * id, and for an UNPAID charge most providers say very little.
 *
 * On a redirect provider that gap is total. InfinitePay's `payment_check`
 * answers an unpaid charge with no amount and no checkout URL, so the stored
 * row came back reading `0 cents, no link` — and a row with no link is one
 * {@link findReusableHostedCharge}-style reuse cannot offer back. One poll of
 * the buyer's own checkout screen was enough to do it, after which the next
 * attempt minted a SECOND payable page for an unchanged basket. Two live links
 * on one order is the double-payment exposure the PIX path has always refused
 * to create (FUT-379); it arrived here through the back door (FUT-669).
 *
 * So the merge keeps the refresh authoritative over exactly what it observed,
 * and the stored row authoritative over everything creation established:
 *
 *  - **status** always comes from the refresh — that is what it is for, and
 *    the caller has already checked the transition goes forward;
 *  - **amount** comes from the refresh whenever it REPORTS one, because a
 *    captured amount is a fact about money and the shortfall guard depends on
 *    reading the real one (FUT-373). A reported 0 is silence, not a price:
 *    while unsettled it means "not captured yet", and on a terminal-but-unpaid
 *    refresh (an EXPIRED PIX order, a CANCELED charge with no amount echoed —
 *    FUT-681) it means the provider had nothing to say about money at all. In
 *    both cases the stored amount stands. A PAID refresh always carries a real
 *    amount — `capturedAmountCents` refuses to fabricate one — so nothing a
 *    settlement reports is ever masked;
 *  - **the instrument** — hosted link, QR, boleto, card — is kept whenever the
 *    refresh carries none. These exist because the charge was CREATED, not
 *    because it was later observed, and a provider that omits them is silent
 *    about them rather than retracting them;
 *  - **method** is kept while the charge is unsettled, for the same reason: an
 *    adapter with nothing to report falls back to a default, and a default is
 *    not an observation. Once settled the refresh knows how it was actually
 *    paid, which on a redirect provider is the first time anybody does.
 *
 * Deliberately additive: this can only ever preserve a field the refresh left
 * empty. A refresh that DOES report something always wins, so nothing here can
 * mask a real change of state.
 */
export function mergeRefreshedSnapshot(
  stored: ChargeSnapshot,
  refreshed: ChargeSnapshot,
): ChargeSnapshot {
  const settled = isTerminal(refreshed.status);
  return {
    ...stored,
    ...refreshed,
    amount: refreshed.amount.amountCents > 0 ? refreshed.amount : stored.amount,
    method: settled ? refreshed.method : stored.method,
    ...keepIfAbsent(stored, refreshed),
    // Hints ACCUMULATE. Each one is learned at a different moment — the invoice
    // `slug` at creation, the `transaction_nsu` only on the return trip — and
    // InfinitePay will not confirm a payment without both, so a refresh that
    // carries one must not drop the other.
    ...(stored.settlementHints || refreshed.settlementHints
      ? { settlementHints: { ...stored.settlementHints, ...refreshed.settlementHints } }
      : {}),
  };
}

/** The fields a silent refresh inherits from the row it is refreshing. */
const INHERITED = ['reference', 'hostedCheckoutUrl', 'pix', 'boleto', 'card'] as const;

function keepIfAbsent(
  stored: ChargeSnapshot,
  refreshed: ChargeSnapshot,
): Partial<ChargeSnapshot> {
  const kept: Record<string, unknown> = {};
  for (const field of INHERITED) {
    if (refreshed[field] === undefined) kept[field] = stored[field];
  }
  return kept as Partial<ChargeSnapshot>;
}
