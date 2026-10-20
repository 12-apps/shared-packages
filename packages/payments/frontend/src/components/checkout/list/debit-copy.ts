/**
 * The debit card row's host inputs (FUT-3754) — their own module for the size
 * gate on `types.ts`, which re-exports them.
 */

/** `PaymentListCopy.debit` — the debit card row and its 3-D Secure refusals. */
export interface PaymentListDebitCopy {
  /** "Cartão de débito". */
  label: string;
  /** "Digite os dados do cartão; o banco pode pedir uma confirmação". */
  hint: string;
  /** The card cannot be authenticated as debit here — try credit or Pix. */
  notSupported: string;
  /** The bank refused the authentication. */
  refused: string;
  /** The authentication could not run (a session, the SDK, the buyer's data). */
  failed: string;
}

/**
 * Where the buyer's card bill goes, as a debit's 3-D Secure needs it
 * (FUT-3754). The host's delivery address is the one it has; Brazil only.
 */
export interface CheckoutBillingAddress {
  street: string;
  number: string;
  complement?: string;
  city: string;
  /** The state's two letters — "SP". */
  regionCode: string;
  postalCode: string;
}
