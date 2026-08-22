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
 * And `views.screens`, which reaches deeper still: the card fields and every
 * refusal a tokenizer can produce, plus the buyer-details inputs. Same rule
 * again, and the same reason for spelling them out here rather than importing
 * the pack — a host that borrows another product's sentences cannot notice
 * when the package starts supplying them again.
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
    screens: {
      card: {
        fields: {
          unknownBrand: 'Cartão',
          numberLabel: 'Número do cartão',
          numberRequired: 'Informe o número do cartão.',
          numberIncomplete: 'Faltam dígitos no número do cartão.',
          numberInvalid: 'Esse número de cartão não confere.',
          holderLabel: 'Nome como está no cartão',
          holderRequired: 'Informe o nome como está no cartão.',
          expiryLabel: 'Validade (MM/AA)',
          cvvLabel: 'CVV',
          monthInvalid: 'O mês da validade não existe.',
          expired: 'Este cartão já venceu.',
          expiryInvalid: 'A validade não confere ou já passou.',
          cvvInvalid: 'O CVV não confere.',
          cvvDigits: (length) => `O CVV deste cartão tem ${length} dígitos.`,
          cpfRequired: 'Informe o CPF.',
          cpfInvalid: 'Esse CPF não confere.',
          savedCardsLabel: 'Cartão',
          newCard: 'Usar outro cartão',
          newCardDescription: 'Digitar os dados agora',
          saveCard: 'Guardar este cartão nesta loja',
        },
        tokenize: {
          sdkUnavailable: 'O meio de pagamento não carregou. Recarregue a página.',
          cardNotProcessed: 'Não deu para ler o cartão. Confira os dados e tente de novo.',
          providerUnreachable: 'Não deu para falar com a operadora. Verifique sua conexão.',
          providerTimedOut: 'A operadora demorou demais para responder.',
          providerRefused: (status, response) =>
            `A operadora recusou os dados do cartão (HTTP ${status}). Resposta: ${response}`,
          noPublicKey:
            'Esta loja está sem a chave de cartão. Tente de novo em instantes ou escolha outra forma de pagar.',
          cardUnavailable:
            'Esta loja não está aceitando cartão agora. Recarregue a página, escolha outra forma de pagar ou combine com a loja.',
        },
      },
      buyer: {
        emailInvalid: 'Esse e-mail não parece válido.',
        emailRequired: 'Informe o e-mail.',
        nameRequired: 'Informe o nome.',
        phoneRequired: 'Informe o telefone.',
        fieldsHint: (names) =>
          names.length === 0
            ? 'Nome, e-mail e telefone são opcionais — servem apenas para o recibo.'
            : `Informe ${names.join(', ')} para pagar. Os outros campos são opcionais.`,
      },
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
