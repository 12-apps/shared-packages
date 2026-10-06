import type { CheckoutScreensCopy } from './screens-copy';

/**
 * The pt-BR pack for the buyer's checkout screens — a NAMED constant a host
 * passes by hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the screens used to render, so a host adopting it sees no change — what
 * changes is that the words are chosen in a diff.
 */
export const PT_BR_CHECKOUT_SCREENS_COPY: CheckoutScreensCopy = {
  method: {
    groupLabel: 'Forma de pagamento',
    pixLabel: 'Pix',
    cardLabel: 'Cartão',
    pixDescription: 'Aprovação imediata',
    pixManualDescription: 'Confirmado pela loja',
    cardDescription: 'Crédito à vista',
    unavailableHere: 'Indisponível nesta loja',
  },
  settling: {
    cannotConfirm: 'Não foi possível confirmar o pagamento',
    takingLonger: 'O pagamento está demorando mais que o esperado',
    takingLongerHelp:
      'Você pode aguardar ou verificar seu pedido em instantes — não realize um novo pagamento.',
    processing: 'Processando pagamento…',
    confirming: 'Estamos confirmando seu pagamento',
    cannotPay: 'Não foi possível pagar',
    connectionLost: 'Sem conexão no momento — continuamos tentando',
    checkAgainAction: 'Verificar de novo',
  },
  pix: {
    heading: 'Pague com Pix',
    qrAlt: 'QR Code PIX para pagamento',
    copyAction: 'Copiar código',
    copiedAction: 'Copiado!',
    copyAgainAction: 'Copiar de novo',
    showQrAction: 'Ver QR code',
    preferCardAction: 'Prefere pagar com cartão?',
    verifying: 'Verificando automaticamente…',
    tabsLabel: 'Forma de pagar o Pix',
    copyPasteTab: 'Copia e cola',
    qrTab: 'QR code',
    qrHeading: 'Pelo celular',
    copyPasteHeading: 'Pix Copia e Cola',
    or: 'ou',
    qrInstructions: 'Abra o app do seu banco no celular, escolha **Pix › Ler QR code** e aponte para a tela.',
    qrTabCaption: 'Escaneie com o app do banco em outro celular.',
    copyPasteHint: 'Cole no app do seu banco em **Pix Copia e Cola**.',
    internetBankingHint: 'Pagando pelo internet banking? Cole o código em **Pix Copia e Cola**.',
    notPaidYet: 'Ainda não pagou?',
    scanFromPhone: 'Escaneie com o app do banco no celular.',
    validUntil: (time) => `Válido até ${time}. A confirmação é automática.`,
    expiryLocale: 'pt-BR',
    awaiting: 'Aguardando pagamento…',
    chargeMissing: 'Não foi possível gerar o código PIX.',
    afterCopy: {
      title: 'Aguardando o pagamento',
      body: (totalLabel, wide) =>
        `Assim que o banco confirmar o pagamento de ${wide ? `**${totalLabel}**` : totalLabel}, seu pedido aparece aqui. Pode deixar esta ${wide ? 'página' : 'tela'} aberta.`,
      stepCopied: 'Código Pix copiado',
      stepPay: (wide) =>
        wide ? 'Pague no app ou no internet banking (Pix Copia e Cola)' : 'Pague no app do seu banco (Pix Copia e Cola)',
      stepConfirm: () => 'O banco confirma o pagamento automaticamente',
    },
    manual: {
      validUntil: (time) => `A loja confirma o pagamento até ${time}.`,
      awaiting: 'Aguardando confirmação da loja…',
      afterCopy: {
        title: 'Aguardando a loja',
        body: (totalLabel, wide) =>
          `Assim que a loja confirmar o recebimento de ${wide ? `**${totalLabel}**` : totalLabel}, seu pedido aparece aqui. Pode deixar esta ${wide ? 'página' : 'tela'} aberta.`,
        stepCopied: 'Código Pix copiado',
        stepPay: (wide) =>
          wide ? 'Pague no app ou no internet banking (Pix Copia e Cola)' : 'Pague no app do seu banco (Pix Copia e Cola)',
        stepConfirm: (time) => `A loja confirma o pagamento — até ${time}`,
      },
    },
  },
  card: {
    heading: 'Pague com cartão',
  },
  payer: {
    taxId: (formatted) => `CPF ${formatted}`,
    taxIdAlreadyKnown: 'CPF já cadastrado',
    payingAs: (name) => `Pagando como ${name}`,
    payingWithSavedDetails: 'Pagando com os seus dados salvos',
    changeAction: 'Alterar',
  },
  error: {
    confirming: 'Estamos confirmando seu pagamento',
    cannotContinue: 'Não foi possível continuar',
    retryAction: 'Tentar novamente',
    emailLabel: 'E-mail para o pagamento',
    emailMustDifferHint: 'use um e-mail diferente do da loja',
    useEmailAction: 'Usar este e-mail e continuar',
  },
  wallet: {
    applePay: {
      orderTotal: 'Total do pedido',
      cannotStart: 'Não foi possível iniciar o Apple Pay nesta loja. Pague com cartão.',
      cannotComplete:
        'Não foi possível iniciar o Apple Pay. Tente novamente ou pague com cartão.',
      payAction: 'Pagar com Apple Pay',
    },
    googlePay: {
      cannotComplete:
        'Não foi possível concluir o pagamento com o Google Pay. Tente novamente ou pague com cartão.',
      buttonLocale: 'pt',
    },
    orPayWithCard: 'ou pague com cartão',
  },
  hosted: {
    destinationNamed: (displayName) => `à página de pagamento da ${displayName}`,
    destinationGeneric: 'à página de pagamento segura do provedor',
    methodsChoice: (methods) => `, onde você escolhe pagar com ${methods}`,
    pixAndCard: 'PIX ou cartão',
    pixOnly: 'PIX',
    cardOnly: 'cartão',
    handoff: (destination, choice) => `Você será levado ${destination}${choice}.`,
    afterwards:
      'Assim que o pagamento for concluído, você volta para cá e nós confirmamos o pedido.',
    startAction: 'Seguir para o pagamento',
    preparing: 'Preparando o pagamento',
  },
  transport: {
    failed: 'Não foi possível concluir a operação. Tente novamente.',
    invalidResponse: 'Resposta inválida do servidor.',
    offline: 'Não foi possível conectar. Verifique sua conexão e tente novamente.',
  },
  validation: {
    taxIdInvalid: 'CPF inválido.',
    nameRequired: 'Informe seu nome.',
    emailInvalid: 'E-mail inválido.',
    phoneInvalid: 'Telefone inválido.',
    required: 'Campo obrigatório.',
  },
  generatingPayment: 'Gerando pagamento…',
  // Verbatim what the component rendered before the key existed, so nothing
  // changes for a Brazilian shopper.
  totalCaption: (items) => `Total · ${items} ${items === 1 ? 'item' : 'itens'}`,
};
