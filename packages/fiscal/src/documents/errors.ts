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
  | "RESEND_CHANGES_PRINTED_FIELDS"
  /** A `RETURN` quotes no document (`referencedDocuments` is absent or empty). */
  | "RETURN_NEEDS_REFERENCE"
  /**
   * A `RETURN` asked of an NFC-e. An NFC-e has no return purpose: the return is
   * an NF-e (model 55) of entry that references the NFC-e's key.
   */
  | "RETURN_ON_NFCE"
  /**
   * `cancelOrReturn` past SEFAZ's window on a document that is not an NFC-e:
   * the buyer's return NF-e of entry answers a consumer's NFC-e only; an NF-e
   * past its window is the issuer's own correction, not this path's.
   */
  | "RETURN_OF_NFCE_ONLY"
  /**
   * `recordSigned` (FUT-4717): an XML a holder signed offline that the package
   * will not record — another CNPJ or environment, not a model 65, not
   * `tpEmis = 9`, a key whose check digit or fields are wrong, or a number
   * outside every block that holder was given. Nothing was recorded.
   */
  | "CONTINGENCY_XML_REFUSED";

export class FiscalDocumentError extends Error {
  readonly code: FiscalDocumentErrorCode;

  constructor(code: FiscalDocumentErrorCode, message: string) {
    super(`[fiscal/documents] ${code}: ${message}`);
    this.name = "FiscalDocumentError";
    this.code = code;
  }
}
