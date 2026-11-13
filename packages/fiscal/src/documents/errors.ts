/**
 * Every refusal the document module makes, as a typed error with a `code`.
 * A message never carries a certificate, a password or a CSC: the module
 * never holds one long enough to quote it.
 */

export type FiscalDocumentErrorCode =
  /** The state machine has no such transition from the document's state. */
  | "TRANSITION_REFUSED"
  /** An input is missing, malformed or out of range. */
  | "INVALID_INPUT"
  /** No emitter profile, issuing point or document under that id. */
  | "NOT_FOUND"
  /** The profile does not let the package issue (`documentPolicy`), or lacks what issuing needs. */
  | "NOT_ISSUABLE"
  /** The signing identity is declared but not built yet (`PLATFORM`). */
  | "NOT_SUPPORTED"
  /** A series' counter passed 999 999 999. */
  | "SERIES_EXHAUSTED"
  /** Another worker advanced the document first; re-read it. */
  | "CONFLICT"
  /** The subject already has a live document of that model (the per-subject guard). */
  | "SUBJECT_HAS_DOCUMENT"
  /** The document's state has no paper to print (only AUTHORIZED, or CONTINGENCY awaiting transmission). */
  | "NOT_PRINTABLE"
  /**
   * A resend of a rejected contingency NFC-e would change what the buyer's
   * DANFE prints and its QR encodes (the total, the buyer's document): such a
   * sale needs a new note, issued by a person.
   */
  | "RESEND_CHANGES_PRINTED_FIELDS";

export class FiscalDocumentError extends Error {
  readonly code: FiscalDocumentErrorCode;

  constructor(code: FiscalDocumentErrorCode, message: string) {
    super(`[fiscal/documents] ${code}: ${message}`);
    this.name = "FiscalDocumentError";
    this.code = code;
  }
}
