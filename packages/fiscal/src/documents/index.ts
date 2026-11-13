/**
 * `@12-apps/fiscal/documents` — the fiscal document record, its state machine,
 * the ports a host implements (store, storage, cipher, signing identity, sale
 * source; the issuer is `@12-apps/fiscal/issuer`) and the service that drives
 * them.
 */

export * from "./types";
export * from "./profile";
export { DOCUMENT_TRANSITIONS, FINAL_STATUSES, canTransition, scrubSecrets, transition } from "./machine";
export type { DocumentInput, Transition } from "./machine";
export { FiscalDocumentError } from "./errors";
export type { FiscalDocumentErrorCode } from "./errors";
export type { Cipher, DocumentStorage, FiscalStore, NumberRequest, SaleDraft, SaleSource } from "./ports";
export { createPlatformIdentity, createSigningIdentities, createStoreCertificateIdentity } from "./signing";
export type { SigningIdentities, SigningIdentity } from "./signing";
export { parseCertificateUpload, parseIssuingPointInput, parseProfileInput } from "./profile-input";
export type { CertificateUpload, EmitterProfileInput, IssuingPointInput } from "./profile-input";
export { FISCAL_CERTIFICATE_EXPIRING, FISCAL_DOCUMENT_REJECTED, drawKeyCode, localIso, xmlKeys } from "./context";
export type { FiscalDocumentsConfig, FiscalNotifyPort, FiscalReasons } from "./context";
export { createFiscalDocuments } from "./service";
export type { CertificateFacts, FiscalDocuments, FiscalDocumentsServiceConfig, IssueInput, SweepReport } from "./service";
export { createMemoryFiscalStore } from "./memory";
export type { MemoryFiscalStore } from "./memory";
export { FISCAL_NEXT_NUMBER_SQL } from "./sql";
export { documentLines } from "./lines";
export type { LineDetails } from "./lines";
