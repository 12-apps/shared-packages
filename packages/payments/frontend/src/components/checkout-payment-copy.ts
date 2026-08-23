/**
 * Every sentence the LEGACY `CheckoutPayment` step renders (FUT-760).
 *
 * A required prop rather than a context, unlike the factory's screens: this
 * component is one plug-and-play step a host drops in itself, and there is no
 * tree of pieces below it to reach. The host already passes `reference`,
 * `amount` and `tokenizeCard` at the same call; the words go beside them.
 *
 * The split is the one the whole port draws. WHICH state the charge is in — a
 * PIX code waiting to be scanned, a hosted page the buyer is about to be sent
 * to, a store with no provider at all — is knowledge of the payments
 * lifecycle, and it stays here. The words are the host's.
 */

/** The money line, and the locale that renders it. */
export interface LegacyMoneyCopy {
  /** The heading above the amount being paid. */
  totalLabel(formattedAmount: string): string;
  /** The button that authorizes it, on both the saved-card and hosted paths. */
  payAction(formattedAmount: string): string;
  /**
   * The BCP-47 tag the amount is formatted in — `'pt-BR'` here, and hard-coded
   * before this port. The CURRENCY is not here: it arrives on the `Money` the
   * host passes, which is the store's own, not a translator's.
   */
  amountLocale: string;
}

/** The two method cards, before a charge exists. */
export interface LegacyMethodCopy {
  groupLabel: string;
  pixTitle: string;
  pixSubtitle: string;
  cardTitle: string;
  cardSubtitle: string;
  /** PIX's own action — this step generates the code rather than charging. */
  generatePixAction: string;
  /** A REDIRECT provider offers no choice: one button, and the buyer leaves. */
  continueToPaymentAction: string;
}

/** The PIX panel: the code, and the wait. */
export interface LegacyPixCopy {
  qrAlt: string;
  /** The label on the copy-and-paste payload field. */
  copyPasteLabel: string;
  copyAction: string;
  copiedAction: string;
  awaiting: string;
}

/** The card form, and the saved cards above it. */
export interface LegacyCardCopy {
  /** The heading over the saved-card radios. */
  heading: string;
  numberLabel: string;
  holderLabel: string;
  /** Its parenthetical spells the ORDER — "MM/AA" in pt-BR, "MM/YY" in en. */
  expiryLabel: string;
  cvvLabel: string;
  payAction: string;
  /** The trailing radio that opens the form. */
  newCard: string;
  /**
   * How a saved card reads. Takes the parts rather than a sentence, because
   * the expiry is optional — a provider that shared none leaves it out.
   */
  savedCard(brand: string, last4: string, expiry?: string): string;
}

/** What this step says when it cannot take a payment at all. */
export interface LegacyRefusalCopy {
  /** No provider is configured — nothing the buyer can do. */
  paymentsOff: string;
  /** The host wired no `tokenizeCard`, so a card cannot be minted here. */
  cardUnavailable: string;
  /** The interstitial before a hosted provider's own page. */
  redirectNotice: string;
}

/** Everything above, in one object a host passes at the mount. */
export interface CheckoutPaymentCopy {
  money: LegacyMoneyCopy;
  method: LegacyMethodCopy;
  pix: LegacyPixCopy;
  card: LegacyCardCopy;
  refusal: LegacyRefusalCopy;
}
