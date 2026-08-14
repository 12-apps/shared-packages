import type { CheckoutCopyFE } from '@12-apps/payments-frontend';

/**
 * THIS HOST'S OWN BUYER-FACING SENTENCES (FUT-760).
 *
 * `copy` is required on `createPaymentFlows` now. It used to be optional over a
 * pt-BR default the package shipped — one product's RESTAURANT vocabulary, a
 * waiter and a mesa and a cardápio — spread into every adopter that said
 * nothing. This harness said nothing, and so rendered that vocabulary while
 * claiming to be an independent consumer.
 *
 * So the words here are deliberately NOT that product's. The harness sells
 * nothing in particular: it says "pedido" and "loja", never "comanda",
 * "garçom" or "cardápio". If the package ever reintroduces a default, these
 * sentences stop appearing and the specs that read them fail — which is the
 * only way a consumer can notice a default coming back.
 *
 * Every field is spelled out rather than spread over a base: the type is the
 * checklist, and a partial object would compile only because some other host's
 * table filled the gaps, which is the arrangement being removed.
 */
export const HARNESS_CHECKOUT_COPY: CheckoutCopyFE = {
  unavailableTitle: 'Pagamento online indisponível',
  unavailableBody:
    'Esta loja não recebe pagamentos por aqui. Combine o pagamento diretamente com a loja para concluir seu pedido.',
  unavailableWithRemedyTitle: 'Outra forma de pagar',
  unavailableWithRemedyBody:
    'Esta loja não recebe pagamentos por aqui. Use a opção abaixo para concluir seu pedido.',
  handoffTitle: 'Você será levado ao pagamento',
  handoffBody:
    'Estamos abrindo a página segura do meio de pagamento. Se ela não abrir sozinha, use o link abaixo.',
  handoffLink: 'Abrir a página de pagamento',
  handoffCancel: 'Voltar',
  returnPending: 'Confirmando seu pagamento…',
  returnUnknown:
    'Não encontramos um pagamento em andamento nesta sessão. Verifique seus pedidos em instantes.',
  emptyCartTitle: 'Seu carrinho está vazio.',
  emptyCartAction: 'Ver a loja',
  continueAction: 'Continuar',
  addCardTitle: 'Adicionar cartão',
  addCardAction: 'Salvar cartão',
  addCardPreparing: 'Preparando o formulário…',
  addCardSavedTitle: 'Cartão salvo',
  addCardSavedBody: 'Você poderá usá-lo nas próximas compras.',
  addCardFailedTitle: 'Não foi possível salvar o cartão',
  addCardUnavailable: 'Esta loja não aceita salvar cartões no momento.',
  manageCardsTitle: 'Meus cartões',
  manageCardsEmpty: 'Você ainda não tem cartões salvos.',
  manageCardsAdd: 'Adicionar cartão',
};
