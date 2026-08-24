import type { CheckoutPaymentCopy } from './checkout-payment-copy';

/**
 * The en-US pack for the legacy `CheckoutPayment` step — a NAMED constant a
 * host passes by hand, never a default.
 *
 * `money.amountLocale` is part of the pack and moves with it: it is what the
 * step formats the total with, so the words around a price and the price
 * itself are written for the same reader. It does NOT change the CURRENCY —
 * an English-reading buyer of a Brazilian store still pays in BRL.
 *
 * PIX keeps its name. It is Brazil's instant-payment scheme, and the buyer will
 * look for those three letters in their banking app.
 */
export const EN_US_CHECKOUT_PAYMENT_COPY: CheckoutPaymentCopy = {
  money: {
    totalLabel: (formattedAmount) => `Total: ${formattedAmount}`,
    payAction: (formattedAmount) => `Pay ${formattedAmount}`,
    amountLocale: 'en-US',
  },
  method: {
    groupLabel: 'Payment method',
    pixTitle: 'PIX',
    pixSubtitle: 'Approved instantly',
    cardTitle: 'Card',
    cardSubtitle: 'Credit, paid in full',
    generatePixAction: 'Generate a PIX QR code',
    continueToPaymentAction: 'Continue to payment',
  },
  pix: {
    qrAlt: 'PIX QR code',
    copyPasteLabel: 'PIX copy-and-paste code',
    copyAction: 'Copy the code',
    copiedAction: 'Copied!',
    awaiting: 'Waiting for payment…',
  },
  card: {
    heading: 'Pay by card',
    numberLabel: 'Card number',
    holderLabel: 'Name printed on the card',
    expiryLabel: 'Expiry (MM/YY)',
    cvvLabel: 'CVV',
    payAction: 'Pay by card',
    newCard: 'New card — enter another card',
    savedCard: (brand, last4, expiry) =>
      `${brand} •••• ${last4}${expiry ? ` — expires ${expiry}` : ''}`,
  },
  refusal: {
    paymentsOff: 'This store does not accept online payments yet.',
    cardUnavailable: 'Card payment is unavailable.',
    redirectNotice: 'You will be taken somewhere secure to finish the payment.',
  },
};
