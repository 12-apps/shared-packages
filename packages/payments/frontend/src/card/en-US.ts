import type { CardCopy } from './copy';

/**
 * The en-US pack for the card form — a NAMED constant a host passes by hand,
 * never a default.
 *
 * `MM/AA` becomes `MM/YY` and `CVV` stays `CVV`, and the difference between
 * those two is the rule: the expiry mask is what the buyer TYPES, so it follows
 * their own notation, while CVV is what is PRINTED on the card and is the same
 * three letters in either language. `CPF` stays too — it is Brazil's taxpayer
 * number, and there is nothing else to call the field a Brazilian buyer is
 * filling in.
 */
export const EN_US_CARD_COPY: CardCopy = {
  fields: {
    unknownBrand: 'Card',
    numberLabel: 'Card number',
    numberRequired: 'Enter the card number.',
    numberIncomplete: 'That card number is incomplete.',
    numberInvalid: 'That card number is not valid.',
    holderLabel: 'Name printed on the card',
    holderRequired: 'Enter the name printed on the card.',
    expiryLabel: 'Expiry (MM/YY)',
    expiryPlaceholder: 'MM/YY',
    cvvLabel: 'CVV',
    expiryIncomplete: 'The expiry is incomplete (MM/YY).',
    monthInvalid: 'That month is not valid.',
    expired: 'That card has expired.',
    expiryInvalid: 'That expiry is not valid, or has passed.',
    cvvRequired: 'Enter the CVV.',
    cvvInvalid: 'That CVV is not valid.',
    // The length differs by brand (3 for most, 4 for Amex), so it is
    // interpolated rather than written out.
    cvvDigits: (length) => `The CVV must be ${length} digits.`,
    cpfRequired: 'CPF is required.',
    cpfInvalid: 'That CPF is not valid.',
    savedCardsLabel: 'Card',
    savedCardExpiry: (month, year) => `Expires ${month}/${year}`,
    newCard: 'New card',
    newCardDescription: 'Enter another card',
    saveCard: 'Save this card for next time',
  },
  tokenize: {
    sdkUnavailable: 'Could not load the payment method. Reload the page.',
    cardNotProcessed: 'Could not process the card. Check the details and try again.',
    providerUnreachable: 'Could not reach the card provider. Check your connection.',
    providerTimedOut: 'The card provider did not answer in time.',
    // The status and the raw response ride along because this is what a store
    // owner forwards to support; a tidier sentence would drop the only part
    // that identifies the failure.
    providerRefused: (status, response) =>
      `The card provider refused the card details (HTTP ${status}). ` + `Response: ${response}`,
    noPublicKey:
      'The card public key is not available for this store. ' +
      'Reconnect the provider and try again.',
    // Ends with what the BUYER can do, in order of how likely each is to work:
    // this is the one message here a shopper reads mid-purchase.
    cardUnavailable:
      'Card payment is unavailable in this store right now. Reload the page and try again, choose another payment method, or arrange it with the store directly.',
  },
};
