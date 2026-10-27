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
  /**
   * The billing address the row asks for when the host has none (FUT-4109).
   * A pack without it offers debit only where the host gives an address.
   */
  address?: {
    /** "CEP de cobrança". */
    postalCode: string;
    /** "Número". */
    number: string;
    /** "Rua" — asked only when the CEP names no street. */
    street: string;
    /** Under the CEP: why the bank wants it. */
    hint: string;
    /** The CEP was not found. */
    notFound: string;
    /** The bar's reason while the address is incomplete. */
    missing: string;
  };
}

/**
 * The host's CEP lookup (FUT-4109): the city and UF a CEP is in, and its street
 * when it names one; `null` for a CEP it does not know. With it, the debit row
 * asks the address itself wherever the host has none to give.
 */
export type CheckoutBillingLookup = (
  postalCode: string,
) => Promise<{ street?: string | null; city: string; regionCode: string } | null>;

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

/** The debit row's host inputs on `CheckoutPaymentList`. */
export interface PaymentListDebitInputs {
  /** The billing address a DEBIT card's 3-D Secure needs (FUT-3754); none ⇒ the row asks it via `billingLookup`. */
  billingAddress?: CheckoutBillingAddress | null;
  /** Looks a CEP up, so the debit row can ask the address in any store type (FUT-4109). */
  billingLookup?: CheckoutBillingLookup;
}
