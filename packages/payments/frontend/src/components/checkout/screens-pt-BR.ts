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
    pixLabel: 'PIX',
    cardLabel: 'Cartão',
    pixDescription: 'Aprovação imediata',
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
  },
  pix: {
    heading: 'Pague com PIX',
    instructions: (totalLabel) =>
      `Escaneie o QR code no app do seu banco ou copie o código. Total ${totalLabel}.`,
    qrAlt: 'QR Code PIX para pagamento',
    copyAction: 'Copiar',
    copiedAction: 'Copiado!',
    validUntil: (time) => `Válido até ${time}. A confirmação é automática.`,
    expiryLocale: 'pt-BR',
    awaiting: 'Aguardando pagamento…',
    chargeMissing: 'Não foi possível gerar o código PIX.',
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
};
