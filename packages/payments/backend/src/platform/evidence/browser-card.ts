/**
 * What the browser reports about each official test card (FUT-3755), split
 * out of `./types.ts` at its size cap when FUT-5806 added the 3DS reason.
 * Re-exported from there, so every import keeps working.
 */

/** Which official test card a browser result is about. */
export const BROWSER_CARD_SCENARIOS = ['approved', 'declined', 'debit'] as const;
export type BrowserCardScenario = (typeof BROWSER_CARD_SCENARIOS)[number];

/** One official test card, as the browser reports it. Never a PAN. */
export interface BrowserCardResult {
  scenario: BrowserCardScenario;
  brand: string;
  /** The number as the reader may see it, e.g. `4539 62** **** 2097`. */
  masked: string;
  /** `PagSeguro.encryptCard`'s output, or null when encryption failed. */
  encrypted: string | null;
  /**
   * Why there is no blob — a CODE, worded by the evidence copy, so the file
   * stays in its reader's language whatever the operator's screen is in.
   */
  failure?: BrowserCardFailure;
  /**
   * The debit card only (FUT-3755): the id PagBank's `authenticate3DS`
   * answered, which the DEBIT_CARD order carries as `authentication_method`.
   * Absent when the authentication did not complete — `failure` says why.
   */
  authenticationId?: string;
  /** Whether the issuer AUTHENTICATED the cardholder (the 3DS test card's expected answer). */
  authenticated?: boolean;
  /**
   * The debit card only (FUT-5806): what PagBank's SDK answered when the
   * authentication did not complete — its status, codes, messages and trace
   * id, as one line (`threeDSFailureSummary`). Never card data. Without it the
   * evidence could only say the authentication "did not complete".
   */
  threeDSReason?: string;
}

export const BROWSER_CARD_FAILURES = [
  'SDK_UNAVAILABLE',
  'NOT_PROCESSED',
  'NO_PUBLIC_KEY',
  'NO_THREEDS_SESSION',
  'THREEDS_NOT_SUPPORTED',
  'THREEDS_REFUSED',
  'THREEDS_FAILED',
] as const;
export type BrowserCardFailure = (typeof BROWSER_CARD_FAILURES)[number];
