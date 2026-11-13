/**
 * `@12-apps/fiscal/documents` — the fiscal document record, its state machine,
 * the ports a host implements (store, storage, cipher, signing identity, sale
 * source; the issuer is `@12-apps/fiscal/issuer`) and the service that drives
 * them.
 */

export * from "./types";
export * from "./profile";
export { DOCUMENT_TRANSITIONS, FINAL_STATUSES, MAX_FAILURES, canTransition, scrubSecrets, transition } from "./machine";
export type { DocumentInput, Transition } from "./machine";
export { FiscalDocumentError } from "./errors";
export type { FiscalDocumentErrorCode } from "./errors";
export type { Cipher, ContingencyBlockSource, DocumentStorage, FiscalStore, NumberRequest, SaleDraft, SaleSource } from "./ports";
export { createPlatformIdentity, createSigningIdentities, createStoreCertificateIdentity } from "./signing";
export type { SigningIdentities, SigningIdentity } from "./signing";
export { parseCertificateUpload, parseIssuingPointInput, parseProfileInput } from "./profile-input";
export type { CertificateUpload, EmitterProfileInput, IssuingPointInput } from "./profile-input";
export {
  FISCAL_CERTIFICATE_EXPIRING,
  FISCAL_CONTINGENCY_DEADLINE,
  FISCAL_DOCUMENT_NEEDS_ATTENTION,
  FISCAL_DOCUMENT_REJECTED,
  computeAccessKey,
  draftOf,
  drawKeyCode,
  localIso,
  xmlKeys,
} from "./context";
export type { FiscalDocumentsConfig, FiscalNotifyPort, FiscalReasons } from "./context";
export { CONTINGENCY_WARNING_AFTER_MS, createFiscalDocuments } from "./service";
export type { CertificateFacts, FiscalDocuments, FiscalDocumentsServiceConfig, IssueInput, SweepReport } from "./service";
export { createMemoryFiscalStore } from "./memory";
export type { MemoryFiscalStore } from "./memory";
export { FISCAL_NEXT_NUMBER_SQL } from "./sql";
export { createPrismaFiscalStore } from "./sql-store";
export type { FiscalPrismaClient, FiscalSqlClient } from "./sql-store";
export { documentLines } from "./lines";
export type { LineDetails } from "./lines";
