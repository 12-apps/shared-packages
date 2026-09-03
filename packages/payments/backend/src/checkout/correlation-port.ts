import type { Money, PaymentMethodKind, ProviderName } from '../core/types';

/**
 * WRITING A CHARGE BACK ONTO THE PAYABLE.
 *
 * Split out of `./types.ts` (which is at its size ceiling) when the buyer's own
 * release gave this port a third writer. Nothing about the contract moved: the
 * host still owns every method, because confirming a payment is a TRANSACTION
 * only the host can compose, and the library still owns WHEN each fires and
 * WITH WHAT AMOUNT.
 */

/** The correlation the host must write to find this charge again. */
export interface AttachedCharge {
  provider: ProviderName;
  providerChargeId: string;
  /**
   * The provider's SECOND correlation id where it has one (PagBank's `ORDE_…`),
   * else the charge id. Derived by the library from the snapshot, so no host
   * reads a provider payload to get it.
   */
  providerOrderId: string;
}

/**
 * Writing a charge back onto the payable.
 *
 * Every method is the host's because confirming a payment is a TRANSACTION only
 * the host can compose — one adopter's writes the payment row, decrements stock
 * with exact COGS, rolls the payable onto the customer profile, emits the
 * buyer's notification and closes a fully-paid table session, all at once, with
 * a shortfall guard that parks a short payment for reconciliation. What the
 * library owns is WHEN each is called and WITH WHAT AMOUNT.
 */
export interface ChargeCorrelationPort {
  /**
   * A charge exists and is PAYABLE — a live QR, a hosted link, a pending 3-D
   * Secure. The payable stays OPEN; only a webhook or a poll settles it.
   */
  attachPending(ref: string, charge: AttachedCharge): Promise<void>;
  /**
   * A CARD charge that settled synchronously. Returns the host's state token.
   */
  recordCardOutcome(input: {
    ref: string;
    charge: AttachedCharge;
    approved: boolean;
    amount: Money;
    /**
     * The provider's OWN verdict on whether another attempt with a different
     * instrument could succeed (FUT-1145) — PagBank's "Retentável" column,
     * normalized. Present only on a REFUSAL, and undefined when the provider
     * offered no guidance.
     *
     * It travels because it changes what the host should DO with the payable,
     * and only the host can act on it: a retriable decline is a buyer who is
     * still trying to buy this, so leaving the payable OPEN lets the next
     * instrument be charged against the SAME order instead of minting a fresh
     * one — which is what leaves a trail of failed orders in a buyer's history
     * for one purchase. A host that ignores it keeps today's behaviour.
     */
    retriable?: boolean;
  }): Promise<string>;
  /**
   * A settlement the library has proof of. `capturedAmount` is what the
   * PROVIDER reported, never the payable's total (FUT-373) — echoing our own
   * total back would settle any capture however small, and would make the
   * host's shortfall guard compare a number with itself. The one exception is
   * the offline stub path, where the library passes the payable's own amount
   * and says so, because a stub snapshot hardcodes zero (FUT-374).
   */
  settle(input: {
    ref: string;
    charge: AttachedCharge;
    capturedAmount: Money;
    method: PaymentMethodKind;
  }): Promise<string>;
  /** A payable whose payment window lapsed. Omit to never expire. */
  expire?(ref: string): Promise<string>;
  /**
   * The BUYER said they did not pay, and the provider agreed (FUT-1146).
   *
   * Fired by `POST /release` only after the provider has been asked and did
   * NOT report a payment, so this is never called on a payable anybody has
   * money for. What "released" means is the host's — cancelled, reopened for
   * another attempt, or simply closed — which is why it is a port and not a
   * status this library writes.
   *
   * Omit to have the route answer the payable's current state and change
   * nothing. The buyer's screen recovers either way; what is lost is only the
   * server-side tidy-up.
   */
  abandon?(ref: string): Promise<string>;
}
