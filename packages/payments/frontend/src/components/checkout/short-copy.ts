import type { PaymentMethodKind } from "@12-apps/payments-backend";

import type { StatusOutcomeCopy } from "./view-copy";

/**
 * The words of a SHORT capture and of a stock-gone payable (FUT-612) — the
 * host's, like every other sentence on the confirmation screen.
 *
 * Functions where a sentence carries an amount, so each language places it
 * where its grammar wants it. The amounts reach them already written:
 * {@link ShortPaymentCopy.money} is how this pack writes cents, so a host whose
 * buyers read another currency or another digit grouping writes its own rather
 * than this package guessing one.
 *
 * What these sentences must never do is say "nothing was charged": every one of
 * them is read by somebody whose money arrived (FUT-612 I5).
 */
export interface ShortPaymentCopy {
  /** Cents as this pack writes money ("R$ 13,80"). */
  money(cents: number): string;
  /** How the money that arrived was paid, by method ("Pix", "Cartão"). */
  methodNames: Record<PaymentMethodKind, string>;
  /** The headline: what is missing. `due` is written by {@link money}. */
  heading(amounts: { due: string }): string;
  /** What arrived of what, and the two ways on. */
  support(amounts: { paid: string; total: string }): string;
  totalLabel: string;
  /** The receipt's paid row, with how it was paid. */
  paidLabel(method: string): string;
  dueLabel: string;
  /** The primary action: pay only what is missing. */
  payAction(amounts: { due: string }): string;
  /** The secondary action, saying what it does: cancel and have the capture returned. */
  refundAction(amounts: { paid: string }): string;
  /** Nothing is left to ask of the buyer (the total moved under it): the store is checking. */
  reviewing(amounts: { paid: string }): StatusOutcomeCopy;
  /**
   * The capture went back. Says only that it did: the fact names no channel,
   * and a store may settle a pending refund another way than the one paid.
   */
  refunded(amounts: { paid: string }): StatusOutcomeCopy;
  /**
   * A refund was asked and is not back yet — a provider series retrying it, or
   * the store finishing it by hand. True for both.
   */
  refundPending(amounts: { paid: string }): StatusOutcomeCopy;
  /**
   * The store collected the difference ITSELF, off the platform, and confirmed.
   * The host sends `resolution: "SETTLED"` for that and nothing else: a buyer
   * who paid the difference here is answered a plain PAID with no shortfall,
   * and gets the ordinary paid receipt.
   */
  settled: StatusOutcomeCopy;
  /**
   * The WHOLE amount arrived and an item ran out: its own notice, with no
   * action — the store confirms or returns the money. `missing` is the host's
   * names of what ran out, exactly as it sent them, joined by
   * {@link joinMissing}; `count` is how many there are, for the verb.
   */
  stockGone(amounts: { received: string; missing: string; count: number }): StatusOutcomeCopy;
  /** The same notice when the host could not name what ran out. */
  stockGoneUnnamed(amounts: { received: string }): StatusOutcomeCopy;
  /** Join the names of what ran out into one phrase ("A, B e C"). */
  joinMissing(names: readonly string[]): string;
}
