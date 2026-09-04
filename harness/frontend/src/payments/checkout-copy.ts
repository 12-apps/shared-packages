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
 * refusal a tokenizer can produce, the buyer-details inputs, the method tiles,
 * the PIX and card panes, the wallet buttons, the hosted handover and the
 * three sentences the transport itself falls back on. Same rule again, and the
 * same reason for spelling them out here rather than importing the pack — a
 * host that borrows another product's sentences cannot notice when the package
 * starts supplying them again.
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
      awaitingUnreachable: {
        heading: 'Não estamos conseguindo falar com o pagamento',
        support:
          'Seguimos tentando por aqui. Se você já pagou, não pague de novo — ' +
          'o pedido é confirmado assim que o banco avisar.',
      },
      // One sentence per normalized reason (FUT-1145). Worded by THIS host, as
      // everything else here is: the package publishes the reason and never the
      // words. A reason with no entry falls back to `failed` above, which is
      // why `UNKNOWN` is deliberately absent.
      declined: {
        INSUFFICIENT_FUNDS: {
          heading: 'Não havia saldo ou limite',
          support: 'Nada foi cobrado. Tente com outro cartão.',
        },
        CARD_DECLINED: {
          heading: 'O banco não autorizou',
          support: 'Nada foi cobrado. Tente outro cartão ou fale com o seu banco.',
        },
        INVALID_CARD: {
          heading: 'Os dados do cartão não foram aceitos',
          support: 'Nada foi cobrado. Confira número, validade e CVV, ou use outro cartão.',
        },
        EXPIRED_CARD: {
          heading: 'Este cartão está vencido',
          support: 'Nada foi cobrado. Use um cartão dentro da validade.',
        },
        FRAUD_SUSPECTED: {
          heading: 'O banco bloqueou esta compra',
          support: 'Nada foi cobrado. Fale com o seu banco ou use outro cartão.',
        },
        PROVIDER_ERROR: {
          heading: 'Não deu para processar agora',
          support: 'Nada foi cobrado. Tente de novo em instantes.',
        },
      },
      retryAction: 'Tentar de novo',
      regenerateAction: 'Gerar outro código',
      checkAgainAction: 'Verificar agora',
      // The buyer's own way out of a hosted wait that has no ending (FUT-1146).
      notPaidAction: 'Não consegui pagar',
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
          expiryIncomplete: 'Validade incompleta (MM/AA).',
          monthInvalid: 'O mês da validade não existe.',
          expired: 'Este cartão já venceu.',
          expiryInvalid: 'A validade não confere ou já passou.',
          cvvRequired: 'Informe o CVV.',
          cvvInvalid: 'O CVV não confere.',
          cvvDigits: (length) => `O CVV deste cartão tem ${length} dígitos.`,
          cpfRequired: 'Informe o CPF.',
          cpfInvalid: 'Esse CPF não confere.',
          savedCardsLabel: 'Cartão',
          savedCardExpiry: (month, year) => `Validade ${month}/${year}`,
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
      screens: {
        method: {
          groupLabel: 'Como você quer pagar',
          pixLabel: 'PIX',
          cardLabel: 'Cartão',
          pixDescription: 'Cai na hora',
          cardDescription: 'Crédito em uma vez',
          unavailableHere: 'Esta loja não aceita esta opção',
        },
        settling: {
          cannotConfirm: 'Não deu para confirmar o pagamento',
          takingLonger: 'O pagamento está levando mais tempo que o normal',
          takingLongerHelp:
            'Espere um pouco ou confira seu pedido em instantes — não pague de novo.',
          processing: 'Enviando o pagamento…',
          confirming: 'Conferindo seu pagamento',
          cannotPay: 'Não deu para pagar',
          connectionLost: 'Sem conexão agora — seguimos tentando',
          checkAgainAction: 'Verificar agora',
        },
        pix: {
          heading: 'Pagar com PIX',
          instructions: (totalLabel) =>
            `Leia o QR code no app do seu banco ou copie o código. São ${totalLabel}.`,
          qrAlt: 'Código QR do PIX',
          copyAction: 'Copiar código',
          copiedAction: 'Código copiado!',
          validUntil: (time) => `Vale até ${time}. A baixa é automática.`,
          expiryLocale: 'pt-BR',
          awaiting: 'Esperando o pagamento…',
          chargeMissing: 'Não deu para gerar o código PIX.',
        },
        card: {
          heading: 'Pagar com cartão',
        },
        payer: {
          taxId: (formatted) => `CPF ${formatted}`,
          taxIdAlreadyKnown: 'CPF que você já tinha informado',
          payingAs: (name) => `Em nome de ${name}`,
          payingWithSavedDetails: 'Com os dados que você já deixou aqui',
          changeAction: 'Trocar',
        },
        error: {
          confirming: 'Conferindo seu pagamento',
          cannotContinue: 'Não deu para seguir',
          retryAction: 'Tentar de novo',
          emailLabel: 'E-mail deste pagamento',
          emailMustDifferHint: 'informe um e-mail que não seja o da loja',
          useEmailAction: 'Seguir com este e-mail',
        },
        wallet: {
          applePay: {
            orderTotal: 'Total a pagar',
            cannotStart: 'Esta loja não consegue abrir o Apple Pay. Pague com cartão.',
            cannotComplete: 'O Apple Pay não abriu. Tente de novo ou pague com cartão.',
            payAction: 'Pagar pelo Apple Pay',
          },
          googlePay: {
            cannotComplete:
              'O pagamento pelo Google Pay não foi concluído. Tente de novo ou pague com cartão.',
            buttonLocale: 'pt',
          },
          orPayWithCard: 'ou use o cartão',
        },
        hosted: {
          destinationNamed: (displayName) => `para a página de pagamento da ${displayName}`,
          destinationGeneric: 'para a página de pagamento do provedor',
          methodsChoice: (methods) => `, onde dá para pagar com ${methods}`,
          pixAndCard: 'PIX ou cartão',
          pixOnly: 'PIX',
          cardOnly: 'cartão',
          handoff: (destination, choice) => `Vamos te levar ${destination}${choice}.`,
          afterwards: 'Terminando o pagamento lá, você volta para cá e confirmamos o pedido.',
          startAction: 'Ir para o pagamento',
          preparing: 'Abrindo o pagamento',
        },
        transport: {
          failed: 'Não deu para concluir. Tente de novo.',
          invalidResponse: 'O servidor respondeu algo inesperado.',
          offline: 'Sem conexão. Confira a sua internet e tente de novo.',
        },
        validation: {
          taxIdInvalid: 'Esse CPF não confere.',
          nameRequired: 'Informe o nome.',
          emailInvalid: 'Esse e-mail não parece válido.',
          phoneInvalid: 'Esse telefone não confere.',
          required: 'Preencha este campo.',
        },
        generatingPayment: 'Criando o pagamento…',
        // The caption beside the amount, on both the details and the payment
        // step. A function because the count inflects.
        totalCaption: (items) => `Total · ${items} ${items === 1 ? 'item' : 'itens'}`,
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
  cardUnknownBrand: 'Cartão',
  cardExpiry: (month, year) => `Vence em ${month}/${year}`,
};
