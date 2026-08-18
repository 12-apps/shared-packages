/**
 * The sentences `createPaymentFlows` renders on its OWN screens (FUT-741).
 *
 * Scope is deliberately narrow and stated rather than implied: this covers the
 * copy the FACTORY owns — the unavailable screen's two remedies, the hosted
 * handover and its fallback link, the empty cart, the buyer form's continue
 * action, and the add-card / manage-cards screens (FUT-183). The screens that
 * already carried their own product copy before this ticket (PIX, card, status)
 * keep it; moving all of it here in the same change that introduces the factory
 * would be a copy rewrite disguised as an API.
 *
 * THE DEFAULTS ARE GONE (FUT-760). `DEFAULT_CHECKOUT_COPY_FE` held one
 * product's RESTAURANT vocabulary — "Pagamento com o garçom", "Chame o garçom
 * para fechar a conta na mesa", "Ver cardápio" — and was spread into every
 * adopter that passed no `copy`. A host selling insurance got a waiter, and
 * nothing failed, because saying nothing is exactly how a host silently adopts
 * another product's voice. `copy` is required on the config now; this file is
 * the port and nothing else.
 */

/** Every buyer-facing string the factory's own screens render. */
export interface CheckoutCopyFE {
  /** No provider connected AND no host remedy: the store simply does not charge. */
  unavailableTitle: string;
  unavailableBody: string;
  /** No provider connected but the host offers a remedy (this repo: the waiter). */
  unavailableWithRemedyTitle: string;
  unavailableWithRemedyBody: string;
  /** The hosted handover interstitial, and the link that is its fallback. */
  handoffTitle: string;
  handoffBody: string;
  handoffLink: string;
  handoffCancel: string;
  /** The return leg, while the parked order is polled to a terminal state. */
  returnPending: string;
  /** The return leg when nothing was parked — the buyer came back to nothing. */
  returnUnknown: string;
  /**
   * The return leg once the bounded wait elapsed and the screen stopped asking
   * (FUT-556) — say that nothing has arrived yet and, above all, not to pay
   * again.
   *
   * OPTIONAL, so adopting a version with the bound is not a breaking change for
   * a host that has not written the sentence yet. The BOUND itself applies
   * either way: with no copy the screen still stops spinning and falls back to
   * `returnPending` as a warning, which is the honest half. The words are the
   * part only a host can own.
   */
  returnTimedOut?: string;
  /** Nothing to check out (cart mode only). */
  emptyCartTitle: string;
  emptyCartAction: string;
  /** The Dados step's primary action. */
  continueAction: string;
  /** The add-card screen (FUT-183): putting a card on file outside a purchase. */
  addCardTitle: string;
  addCardAction: string;
  addCardPreparing: string;
  addCardSavedTitle: string;
  addCardSavedBody: string;
  addCardFailedTitle: string;
  /** The host wired no vaulting, or the provider cannot vault — the buyer can fix neither. */
  addCardUnavailable: string;
  /** The manage-cards screen: the buyer's cards on file, and the door to add one. */
  manageCardsTitle: string;
  manageCardsEmpty: string;
  manageCardsAdd: string;
}
