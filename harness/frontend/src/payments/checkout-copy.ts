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
 * The same rule now covers `views` — the stepper, the Dados step, the empty
 * cart and the whole confirmation screen. Those views used to carry their own
 * compiled-in Portuguese (the `PT_BR_CHECKOUT_VIEW_COPY` pack is that text,
 * named); this host words them itself for the same reason as everything else.
 *
 * Every field is spelled out rather than spread over a base: the type is the
 * checklist, and a partial object would compile only because some other host's
 * table filled the gaps, which is the arrangement being removed.
 */
export const HARNESS_CHECKOUT_COPY: CheckoutCopyFE = {
  views: {
    steps: {
      dados: 'Identificação',
      payment: 'Pagamento',
      status: 'Comprovante',
    },
    dados: {
      saveProfile: 'Guardar meus dados nesta loja',
      cannotContinueTitle: 'Confira seus dados',
      continueAction: 'Continuar',
      secureNotice: 'Seus dados trafegam protegidos',
      keepShopping: 'Voltar às compras',
      back: 'Voltar',
    },
    emptyCart: {
      title: 'Seu carrinho está vazio.',
      action: 'Ver a loja',
    },
    status: {
      paid: {
        heading: 'Tudo certo com seu pedido',
        support: 'O pagamento foi aprovado e o pedido está registrado.',
      },
      awaiting: {
        heading: 'Aguardando a confirmação',
        support: 'Em instantes o pagamento deve ser confirmado. Mantenha esta tela aberta.',
      },
      failed: {
        heading: 'O pagamento não foi concluído',
        support: 'Nada foi cobrado. Tente de novo quando quiser.',
      },
      expired: {
        heading: 'Este código não vale mais',
        support: 'Nada foi cobrado. Gere outro código para pagar.',
      },
      awaitingTimedOut: {
        heading: 'A confirmação ainda não chegou',
        support:
          'Se você já pagou, aguarde: o pedido será confirmado assim que o banco avisar — ' +
          'não pague uma segunda vez. Pode fechar esta tela.',
      },
      retryAction: 'Tentar de novo',
      regenerateAction: 'Gerar outro código',
      backAction: 'Voltar à loja',
      amountLabel: 'Total pago',
      referenceLabel: 'Referência',
      receiptEmailLabel: 'Recibo enviado para',
    },
  },
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
  continueAction: 'Continuar',
  secureNotice: 'Seus dados trafegam protegidos',
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
