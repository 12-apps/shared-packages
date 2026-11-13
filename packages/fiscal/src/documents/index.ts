/**
 * `@12-apps/fiscal/documents` — the fiscal document record, its state machine,
 * the ports a host implements (store, number counter, storage, cipher,
 * signing identity, sale source, issuer) and the service that drives them.
 */

export * from "./types";
export { DOCUMENT_TRANSITIONS, FINAL_STATUSES, canTransition, scrubSecrets, transition } from "./machine";
export type { DocumentInput, Transition } from "./machine";
export { FiscalDocumentError } from "./errors";
export type { FiscalDocumentErrorCode } from "./errors";
