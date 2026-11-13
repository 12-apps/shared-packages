/**
 * `@12-apps/fiscal/notifications` — what the package tells people about,
 * as notification blueprints over the HOST's words (the estate's sanctioned
 * shape for a package alert: a factory over copy, never pre-worded here).
 *
 * - `fiscal.certificate-expiring`, emitted by the `certificate-expiry` job to
 *   holders of `fiscal:manage`;
 * - `fiscal.document-rejected`, emitted by the document service to holders of
 *   `fiscal:issue` when SEFAZ (or the fiscal service) refuses a document.
 *
 * Each blueprint is a structural twin of the wiring contract's
 * `WireNotificationBlueprint`; the host feeds them to its notifications mount.
 */

import { FISCAL_CERTIFICATE_EXPIRING, FISCAL_DOCUMENT_REJECTED } from "./documents/context";
import type { FiscalDocumentModel } from "./documents/types";

export { FISCAL_CERTIFICATE_EXPIRING, FISCAL_DOCUMENT_REJECTED };

export interface CertificateExpiringPayload {
  readonly ownerId: string;
  readonly expiresAt: string;
  /** Whole days left; 0 is today, negative is expired. */
  readonly daysLeft: number;
}

export interface DocumentRejectedPayload {
  readonly documentId: string;
  readonly subjectId: string;
  readonly model: FiscalDocumentModel;
  readonly series: number;
  readonly number: number;
  /** SEFAZ's `cStat`, or the fiscal service's named code. */
  readonly code: string | null;
  /** SEFAZ's own reason, as the service read it. */
  readonly reason: string;
}

export interface FiscalNotificationContent {
  title: string;
  body: string;
  link?: string;
  data?: Readonly<Record<string, unknown>>;
}

export interface FiscalNotificationContext {
  readonly locale?: string | null;
}

/** The host's words for each event, per recipient. */
export interface FiscalNotificationCopy {
  certificateExpiring(payload: CertificateExpiringPayload, context?: FiscalNotificationContext): FiscalNotificationContent;
  documentRejected(payload: DocumentRejectedPayload, context?: FiscalNotificationContext): FiscalNotificationContent;
}

export interface FiscalNotificationBlueprint<TPayload> {
  type: string;
  category: string;
  generate(payload: TPayload, context?: FiscalNotificationContext): FiscalNotificationContent;
}

/** The suggested preference category; the host's taxonomy decides. */
export const FISCAL_NOTIFICATION_CATEGORY = "fiscal";

export function createFiscalNotificationBlueprints(copy: FiscalNotificationCopy): readonly [
  FiscalNotificationBlueprint<CertificateExpiringPayload>,
  FiscalNotificationBlueprint<DocumentRejectedPayload>,
] {
  if (typeof copy?.certificateExpiring !== "function" || typeof copy.documentRejected !== "function") {
    throw new TypeError("createFiscalNotificationBlueprints needs certificateExpiring and documentRejected.");
  }
  return [
    {
      type: FISCAL_CERTIFICATE_EXPIRING,
      category: FISCAL_NOTIFICATION_CATEGORY,
      generate: (payload, context) => copy.certificateExpiring(payload, context),
    },
    {
      type: FISCAL_DOCUMENT_REJECTED,
      category: FISCAL_NOTIFICATION_CATEGORY,
      generate: (payload, context) => copy.documentRejected(payload, context),
    },
  ];
}
