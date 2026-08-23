import type { CheckoutPaymentCopy } from './checkout-payment-copy';

/**
 * The pt-BR pack for the legacy `CheckoutPayment` step — a NAMED constant a
 * host passes by hand, never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the step used to render, so a host adopting it sees no change — what changes
 * is that the words are chosen in a diff.
 */
export const PT_BR_CHECKOUT_PAYMENT_COPY: CheckoutPaymentCopy = {
  money: {
    totalLabel: (formattedAmount) => `Total: ${formattedAmount}`,
    payAction: (formattedAmount) => `Pagar ${formattedAmount}`,
    amountLocale: 'pt-BR',
  },
  method: {
    groupLabel: 'Forma de pagamento',
    pixTitle: 'PIX',
    pixSubtitle: 'Aprovação imediata',
    cardTitle: 'Cartão',
    cardSubtitle: 'Crédito à vista',
    generatePixAction: 'Gerar QR Code PIX',
    continueToPaymentAction: 'Continuar para o pagamento',
  },
  pix: {
    qrAlt: 'QR Code PIX',
    copyPasteLabel: 'PIX copia e cola',
    copyAction: 'Copiar código',
    copiedAction: 'Copiado!',
    awaiting: 'Aguardando pagamento…',
  },
  card: {
    heading: 'Pague com cartão',
    numberLabel: 'Número do cartão',
    holderLabel: 'Nome impresso no cartão',
    expiryLabel: 'Validade (MM/AA)',
    cvvLabel: 'CVV',
    payAction: 'Pagar com cartão',
    newCard: 'Novo cartão — inserir outro cartão',
    savedCard: (brand, last4, expiry) =>
      `${brand} •••• ${last4}${expiry ? ` — Validade ${expiry}` : ''}`,
  },
  refusal: {
    paymentsOff: 'Esta loja ainda não aceita pagamentos online.',
    cardUnavailable: 'Pagamento com cartão indisponível.',
    redirectNotice: 'Você será direcionado para concluir o pagamento com segurança.',
  },
};
