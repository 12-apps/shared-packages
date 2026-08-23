/**
 * The two shapes the legacy `CheckoutPayment` step and its views both name.
 *
 * Their own module so the views can import them without importing the
 * container that renders the views — the circular import that would otherwise
 * follow from splitting the file (FUT-760). Both stay exported from the
 * package root, where they have always been.
 */

/** What the card form collects, before anything is tokenized. */
export interface CardFormValues {
  number: string;
  holder: string;
  expiry: string;
  cvv: string;
}

/** A provider-vaulted card the buyer may reuse ("Mastercard •••• 7599"). */
export interface SavedCardOption {
  savedCardToken: string;
  brand: string;
  last4: string;
  /** e.g. "02/2034" — shown beside the brand, worded by the host. */
  expiry?: string;
}
