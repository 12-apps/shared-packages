/**
 * The card-entry vocabulary, shared by every surface that takes a card.
 *
 * These lived in the storefront checkout until the admin needed the SAME form:
 * activating a payment provider is now earned by a real R$0,01 charge on the
 * owner's own card (FUT-463), and that has to exercise the shopper's exact
 * path — same fields, same validation, same tokenization — or it proves
 * nothing about what a shopper will hit.
 */

/**
 * Raw card details entered in the form. These NEVER leave the browser — they
 * are handed to `tokenizeCard` (the PagBank JS SDK in production) and only the
 * resulting {@link CardToken} is sent to the server, so the PAN stays out of
 * PCI scope.
 */
export interface CardDetails {
  number: string;
  holder: string;
  /** `MM/YY`. */
  expiry: string;
  cvv: string;
}

/** A client-side card token — the only card data that reaches the server. */
export interface CardToken {
  token: string;
  brand: string;
  last4: string;
}

/**
 * A previously-saved card available for reuse. Only display metadata is kept
 * client-side — the reusable token lives server-side keyed by {@link id}.
 */
export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  holder: string;
}

/** Per-field validation messages; `undefined` means the field is fine. */
export interface CardFieldErrors {
  number?: string;
  holder?: string;
  expiry?: string;
  cvv?: string;
}

/** Sentinel selection value meaning "enter a new card". */
export const NEW_CARD = "new";
