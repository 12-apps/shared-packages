/**
 * Every owner-facing sentence the activation flow can produce, as a port
 * (FUT-760).
 *
 * Same split `CheckoutCopy` already draws one screen over: the library decides
 * WHICH situation the owner is in — a refused proof charge, an expired one, a
 * provider we could not reach at all, a platform-level approval that is not
 * ours to chase — and those classifications are the money-safety rules, so
 * they stay here. The WORDS are the host's.
 *
 * The distinction this port exists to protect is the one `platformApproval`
 * below is about: an owner told to "complete the homologação" goes after a task
 * that is the PLATFORM's, not their store's. Which of the two situations it is
 * stays the library's answer; how a host says it does not.
 */
export interface ActivationCopy {
  /** No connection saved yet — there is nothing to charge against. */
  connectFirst: string;
  /** A hosted-checkout provider accepted the charge but returned no URL. */
  noPaymentUrl: string;
  /** A previous proof charge is still settling; a second would be a duplicate. */
  stillProcessing: string;
  /** The proof charge aged out before the owner paid it. */
  expired: string;
  /** The owner's own instrument refused — nothing about the connection. */
  instrumentDeclined: string;
  /**
   * The proof charge came back refused, with the provider's own reason.
   *
   * A function rather than a template with a slot: where the parenthetical
   * sits, and whether a language uses one at all, is the translator's call.
   */
  chargeDeclined(providerReason: string): string;
  /** The proof charge came back in a status that is not approval. */
  chargeNotApproved(status: string): string;
  /** The link is minted and nobody has paid it yet — a wait, not a failure. */
  awaitingPayment: string;
  /**
   * The provider is registered but cannot be POLLED — it declares no
   * `findChargeByReference`, so the redirect proof has no way to ask whether
   * the cent arrived. Named, because which provider it was is the only part
   * of this an owner can act on.
   */
  unpollable(providerName: string): string;
  /**
   * We could not reach the provider at all — named, because "we could not
   * reach the provider" is the same sentence with the one useful word removed.
   */
  unreachable(providerName: string): string;
  /**
   * The provider has not cleared THE PLATFORM for real charges.
   *
   * The one sentence in here that is about who owns the problem rather than
   * what went wrong, and the reason this whole port is worth having: it must
   * not read as a task the store can go and do.
   *
   * Not parameterised by provider, unlike `unreachable`: the branch that
   * produces it recognises PagBank's own ACCESS_DENIED/whitelist wording from
   * a raw error string and has no provider in hand. Naming the vendor is the
   * host's business anyway — this key is where it does it.
   */
  platformApproval: string;
}
