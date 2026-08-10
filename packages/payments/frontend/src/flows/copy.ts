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
 * Every default below is today's pt-BR, verbatim — a host that passes no `copy`
 * reads exactly what a buyer reads now.
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

export const DEFAULT_CHECKOUT_COPY_FE: CheckoutCopyFE = {
  unavailableTitle: "Pagamento online indisponível",
  unavailableBody:
    "Esta loja não recebe pagamentos pelo site. Combine o pagamento diretamente com a loja para concluir seu pedido.",
  unavailableWithRemedyTitle: "Pagamento com o garçom",
  unavailableWithRemedyBody:
    "Esta loja não recebe pagamentos pelo site. Chame o garçom para fechar a conta na mesa.",
  handoffTitle: "Você será levado ao pagamento",
  handoffBody:
    "Estamos abrindo a página segura do meio de pagamento. Se ela não abrir sozinha, use o link abaixo.",
  handoffLink: "Abrir a página de pagamento",
  handoffCancel: "Voltar",
  returnPending: "Confirmando seu pagamento…",
  returnUnknown:
    "Não encontramos um pagamento em andamento nesta sessão. Verifique seus pedidos em instantes.",
  emptyCartTitle: "Seu carrinho está vazio.",
  emptyCartAction: "Ver cardápio",
  continueAction: "Continuar",
  addCardTitle: "Adicionar cartão",
  addCardAction: "Salvar cartão",
  addCardPreparing: "Preparando o formulário…",
  addCardSavedTitle: "Cartão salvo",
  addCardSavedBody: "Você poderá usá-lo nas próximas compras.",
  addCardFailedTitle: "Não foi possível salvar o cartão",
  addCardUnavailable: "Esta loja não aceita salvar cartões no momento.",
  manageCardsTitle: "Meus cartões",
  manageCardsEmpty: "Você ainda não tem cartões salvos.",
  manageCardsAdd: "Adicionar cartão",
};
