/**
 * `@12-apps/fiscal/notifications` — what the package tells people about,
 * as notification blueprints over the HOST's words (the estate's sanctioned
 * shape for a package alert: a factory over copy, never pre-worded here).
 *
 * - `fiscal.certificate-expiring`, emitted by the `certificate-expiry` job to
 *   holders of `fiscal:manage`;
 * - `fiscal.document-rejected`, emitted by the document service to holders of
 *   `fiscal:issue` when SEFAZ (or the fiscal service) refuses a document;
 * - `fiscal.document-needs-attention`, to holders of `fiscal:issue` when a
 *   document stops being retried: a settlement SEFAZ refused (241, 256, 501, a
 *   certificate refused) or too many failures in a row;
 * - `fiscal.contingency-deadline`, to holders of `fiscal:issue` when an NFC-e
 *   is still offline 20 hours after it was signed (the deadline is 24).
 *
 * Each blueprint is a structural twin of the wiring contract's
 * `WireNotificationBlueprint`; the host feeds them to its notifications mount.
 */

import {
  FISCAL_CERTIFICATE_EXPIRING,
  FISCAL_CONTINGENCY_DEADLINE,
  FISCAL_DOCUMENT_NEEDS_ATTENTION,
  FISCAL_DOCUMENT_REJECTED,
} from "./documents/context";
import type { FiscalDocumentModel, FiscalDocumentStatus, NumberVoid } from "./documents/types";

export { FISCAL_CERTIFICATE_EXPIRING, FISCAL_CONTINGENCY_DEADLINE, FISCAL_DOCUMENT_NEEDS_ATTENTION, FISCAL_DOCUMENT_REJECTED };

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

export interface DocumentNeedsAttentionPayload {
  readonly documentId: string;
  readonly subjectId: string;
  readonly model: FiscalDocumentModel;
  readonly status: FiscalDocumentStatus;
  readonly numberVoid: NumberVoid | null;
  readonly series: number;
  readonly number: number;
  readonly code: string | null;
  readonly reason: string;
  readonly failures: number;
}

export interface ContingencyDeadlinePayload {
  readonly documentId: string;
  readonly subjectId: string;
  readonly series: number;
  readonly number: number;
  /** When it was signed offline, local time with offset. */
  readonly since: string;
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
  documentNeedsAttention(payload: DocumentNeedsAttentionPayload, context?: FiscalNotificationContext): FiscalNotificationContent;
  contingencyDeadline(payload: ContingencyDeadlinePayload, context?: FiscalNotificationContext): FiscalNotificationContent;
}

export interface FiscalNotificationBlueprint<TPayload> {
  type: string;
  category: string;
  generate(payload: TPayload, context?: FiscalNotificationContext): FiscalNotificationContent;
}

/** The suggested preference category; the host's taxonomy decides. */
export const FISCAL_NOTIFICATION_CATEGORY = "fiscal";

const COPY_KEYS = ["certificateExpiring", "documentRejected", "documentNeedsAttention", "contingencyDeadline"] as const;

export function createFiscalNotificationBlueprints(copy: FiscalNotificationCopy): readonly [
  FiscalNotificationBlueprint<CertificateExpiringPayload>,
  FiscalNotificationBlueprint<DocumentRejectedPayload>,
  FiscalNotificationBlueprint<DocumentNeedsAttentionPayload>,
  FiscalNotificationBlueprint<ContingencyDeadlinePayload>,
] {
  const missing = COPY_KEYS.filter((key) => typeof copy?.[key] !== "function");
  if (missing.length > 0) throw new TypeError(`createFiscalNotificationBlueprints needs ${missing.join(", ")}.`);
  const blueprint = <T>(type: string, render: (payload: T, context?: FiscalNotificationContext) => FiscalNotificationContent) => ({
    type,
    category: FISCAL_NOTIFICATION_CATEGORY,
    generate: (payload: T, context?: FiscalNotificationContext) => render(payload, context),
  });
  return [
    blueprint(FISCAL_CERTIFICATE_EXPIRING, copy.certificateExpiring),
    blueprint(FISCAL_DOCUMENT_REJECTED, copy.documentRejected),
    blueprint(FISCAL_DOCUMENT_NEEDS_ATTENTION, copy.documentNeedsAttention),
    blueprint(FISCAL_CONTINGENCY_DEADLINE, copy.contingencyDeadline),
  ];
}
