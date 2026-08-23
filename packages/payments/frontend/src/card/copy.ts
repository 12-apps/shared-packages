/**
 * Every sentence the card form and its tokenizers put in front of a BUYER
 * (FUT-760).
 *
 * Required, with no defaults, which is this package's own doctrine
 * (`components/checkout/view-copy.ts` states it): a default in the origin
 * host's language reads as finished to the next host right up until a shopper
 * sees it.
 *
 * The split is the one the whole port draws. WHICH refusal this is — a number
 * that fails Luhn, an expiry already past, a CVV of the wrong length for the
 * detected network, an SDK that never loaded, a provider that refused the
 * card outright — is knowledge of card processing, and it stays here. The
 * words are the host's.
 */

/**
 * The card networks this form can recognise from a number's prefix.
 *
 * `Unknown` used to be spelled `"Cartão"` — a Portuguese word inside an
 * exported TYPE UNION, so it reached every adopter's types and, through
 * `CardBrand`, their API surface. A string leak is cosmetic; a union member is
 * structural, and it propagates. The brand's LABEL is
 * {@link CardFieldCopy.unknownBrand} now, and the union names the fact.
 */
export type CardBrand = 'Visa' | 'Mastercard' | 'Amex' | 'Elo' | 'Unknown';

/** The card form's labels and its field-level refusals. */
export interface CardFieldCopy {
  /** The adornment shown when the number matches no network we know. */
  unknownBrand: string;
  numberLabel: string;
  numberRequired: string;
  numberIncomplete: string;
  numberInvalid: string;
  holderLabel: string;
  holderRequired: string;
  /**
   * The expiry field's label, whose parenthetical spells the ORDER — "MM/AA"
   * in Portuguese, "MM/YY" in English. Unaccented, so no diacritic scan ever
   * flagged it, and getting it wrong makes a buyer type the year first.
   */
  expiryLabel: string;
  /**
   * The same order, inside the box. It sat here as `"MM/AA"` while the LABEL
   * beside it was already required config — so a host could translate the
   * label and be contradicted by the field one line down.
   */
  expiryPlaceholder: string;
  cvvLabel: string;
  /**
   * The expiry field holds something that is not yet `MM/AA` at all — too few
   * digits, or the wrong shape. Distinct from {@link monthInvalid}, which is a
   * well-formed date with an impossible month.
   */
  expiryIncomplete: string;
  /** A month outside 1–12 — a typo, not an expiry. */
  monthInvalid: string;
  /** A well-formed date that has already passed. */
  expired: string;
  /**
   * Either of the two, from a tokenizer that cannot tell them apart: it reads
   * the expiry as one string and only learns it is unusable.
   */
  expiryInvalid: string;
  /** No CVV typed at all — distinct from one of the wrong length. */
  cvvRequired: string;
  cvvInvalid: string;
  /**
   * The CVV is the wrong length for the detected network — Amex wants four,
   * everyone else three.
   *
   * A function, because where the number sits in the sentence is the
   * translator's call, and some languages agree the noun with it.
   */
  cvvDigits(length: number): string;
  cpfRequired: string;
  cpfInvalid: string;
  /** The saved-cards radio group's own label. */
  savedCardsLabel: string;
  /**
   * A saved card's second line — the expiry, already zero-padded and split
   * into month and year. The WORD in front of it is this host's; the order it
   * reads in is the same order {@link expiryLabel} promised.
   */
  savedCardExpiry(month: string, year: number): string;
  /** The trailing option that opens the new-card form. */
  newCard: string;
  newCardDescription: string;
  /** The "keep this card" checkbox. */
  saveCard: string;
}

/** What can go wrong between "Pagar" and a token, in the buyer's words. */
export interface CardTokenizeCopy {
  /** The provider's browser SDK never loaded. */
  sdkUnavailable: string;
  /** The SDK loaded and refused the card data it was handed. */
  cardNotProcessed: string;
  /** We could not reach the tokenizing provider at all. */
  providerUnreachable: string;
  /**
   * The tokenizer was reached and simply did not answer in time.
   *
   * Separate from unreachable because the buyer's next move differs: an
   * outage is worth retrying now, a timeout usually means trying the other
   * method. Unaccented in pt-BR, so only a reading found it.
   */
  providerTimedOut: string;
  /**
   * The provider answered, refusing the card's details.
   *
   * Takes the status AND the provider's own truncated answer, because both
   * are what a human reads back to support — this failure surfaces on the
   * activation screen, and carrying the raw response there is deliberate.
   * Where either sits in the sentence is the translator's call.
   */
  providerRefused(status: number, response: string): string;
  /**
   * This store has no card-encryption key, so the browser cannot encrypt
   * anything. A configuration fault, phrased for the person who hit it.
   */
  noPublicKey: string;
  /**
   * Card is off for this store entirely — the sentence that has to offer the
   * buyer somewhere else to go, because there is nothing they can retry.
   */
  cardUnavailable: string;
}

/** Both halves, for a host wiring the card form in one place. */
export interface CardCopy {
  fields: CardFieldCopy;
  tokenize: CardTokenizeCopy;
}
