import type { CheckoutCopyFE } from "../flows/copy";

/**
 * THE DEMO HOST'S OWN VOICE (FUT-760).
 *
 * This table used to be `DEFAULT_CHECKOUT_COPY_FE`, exported from the package
 * and spread into every adopter that passed no `copy`. It is one product's
 * restaurant vocabulary — a waiter, a mesa, a cardápio — so a host selling
 * anything else silently inherited a voice that did not describe its business,
 * and nothing failed to tell it so.
 *
 * `copy` is required on `PaymentFlowsConfig` now, and these stories are a HOST:
 * they answer it, here, in their own words. That is the arrangement every
 * adopter has, which is the point of the stories rendering it this way.
 */
export const STORY_CHECKOUT_COPY: CheckoutCopyFE = {
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
  returnTimedOut:
    "Se você já pagou, o pedido é confirmado assim que a operadora avisar — não pague de novo.",
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
