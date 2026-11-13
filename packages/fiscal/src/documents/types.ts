/**
 * The fiscal document record and its event log — the shape the package's
 * Prisma partial stores (`prisma/fiscal.prisma`, `FiscalDocument` and
 * `FiscalDocumentEvent`) and the state machine (`./machine`) transitions.
 *
 * A document is ONE number: one issuing point, one series, one `nNF`. A sale
 * that goes offline is a second document on the issuing point's contingency
 * series, and the first one is `REPLACED` (see `./machine`). The record is
 * keyed by an opaque `subjectId`: what the subject is (an order, a payment,
 * several orders) is the host's to know, never this package's.
 */

import type { SaleForDocument } from "../sale/types";
import type { SefazEnvironment, SidecarErrorClass } from "../sidecar/types";

/** The document model: NF-e (55) or NFC-e (65). NFS-e is not a model of this package yet (FUT-2242). */
export type FiscalDocumentModel = "NFE" | "NFCE";

export const FISCAL_DOCUMENT_MODELS: readonly FiscalDocumentModel[] = ["NFE", "NFCE"];

/**
 * - `PENDING`: numbered and stored, not yet handed to the issuer.
 * - `SUBMITTED`: handed to the issuer; no final answer yet (a retry is owed).
 * - `AUTHORIZED`: SEFAZ authorised it. The only state a cancel leaves.
 * - `REJECTED`: refused (SEFAZ's `cStat`, or a request the service refuses as
 *   malformed). Final; its number was not spent at SEFAZ and is inutilized.
 * - `DENIED`: a denial of use. Final; the number IS spent.
 * - `CONTINGENCY`: signed offline (`tpEmis = 9`), owed a transmission.
 * - `CANCELLED`: an authorised document cancelled at SEFAZ.
 * - `REPLACED`: its sale moved to another document (the contingency one);
 *   its number is settled apart (`numberVoid`).
 */
export type FiscalDocumentStatus =
  | "PENDING"
  | "SUBMITTED"
  | "AUTHORIZED"
  | "REJECTED"
  | "DENIED"
  | "CONTINGENCY"
  | "CANCELLED"
  | "REPLACED";

export const FISCAL_DOCUMENT_STATUSES: readonly FiscalDocumentStatus[] = [
  "PENDING",
  "SUBMITTED",
  "AUTHORIZED",
  "REJECTED",
  "DENIED",
  "CONTINGENCY",
  "CANCELLED",
  "REPLACED",
];

/** Which of the issuing point's series the number came from. */
export type SeriesKind = "ONLINE" | "CONTINGENCY";

/**
 * What is still owed on a number SEFAZ never used, so the sequence has no
 * unexplained gap:
 *
 * - `null`: nothing — the number is a document (authorised, denied, owed a
 *   transmission) or still in flight.
 * - `LOOKUP_FIRST`: a request went out with no answer before the sale moved
 *   to contingency; look the key up before deciding.
 * - `INUTILIZE`: never used at SEFAZ; inutilize it.
 * - `CANCEL`: the lookup found it authorised after all; cancel it.
 * - `INUTILIZED` / `CANCELLED`: settled.
 */
export type NumberVoid = "LOOKUP_FIRST" | "INUTILIZE" | "CANCEL" | "INUTILIZED" | "CANCELLED";

/** The order figures a document carries, in integer cents. */
export interface DocumentTotals {
  /** What the buyer pays: Σ line values − Σ discounts. */
  readonly totalCents: number;
  readonly discountCents: number;
  readonly cbsCents: number;
  readonly ibsUfCents: number;
  readonly ibsMunCents: number;
}

/** One fiscal document. */
export interface FiscalDocument {
  readonly id: string;
  /** The emitter profile's owner: an opaque id the host maps (a store, a company). */
  readonly ownerId: string;
  /** What the document is FOR, opaque: the host links it to its orders. */
  readonly subjectId: string;
  readonly issuingPointId: string;
  readonly model: FiscalDocumentModel;
  readonly environment: SefazEnvironment;
  readonly seriesKind: SeriesKind;
  readonly series: number;
  readonly number: number;
  /** `cNF`, drawn once: a retried call yields the same key. */
  readonly keyCode: string;
  readonly status: FiscalDocumentStatus;
  /** The sale as sent, issuer and number filled in. Never a secret. */
  readonly sale: SaleForDocument;
  readonly totals: DocumentTotals;
  /** The buyer's CPF/CNPJ at issue time, or `null`. */
  readonly buyerTaxId: string | null;
  readonly accessKey: string | null;
  /** The authorisation (or denial) protocol. */
  readonly protocol: string | null;
  /** The last SEFAZ `cStat`, or the service's named code. */
  readonly statusCode: string | null;
  readonly statusReason: string | null;
  /** The class of the last failed call, or `null`. */
  readonly lastErrorClass: SidecarErrorClass | null;
  /** A request went out and neither it nor its lookup was answered. */
  readonly outcomeUnknown: boolean;
  /** `dhEmi`. */
  readonly issuedAt: string;
  readonly authorizedAt: string | null;
  readonly contingency: { readonly since: string; readonly reason: string } | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly cancelProtocol: string | null;
  /** The document this one's sale moved to. */
  readonly replacedById: string | null;
  readonly numberVoid: NumberVoid | null;
  /** Storage keys: the signed or authorised XML, and the cancel or inutilization event's XML. */
  readonly xmlKey: string | null;
  readonly eventXmlKey: string | null;
  /** Calls made to the issuer for this document. */
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** What the state machine was fed: the kind of the input that made the event. */
export type DocumentEventKind =
  | "SUBMIT"
  | "AUTHORIZE"
  | "DENY"
  | "REJECT"
  | "RETRY"
  | "SIGN_OFFLINE"
  | "REPLACE"
  | "CANCEL"
  | "LOOKUP"
  | "INUTILIZE";

/**
 * One transition, as stored. `answer` is what the fiscal service answered,
 * verbatim but for any secret-named key (`scrubSecrets`), so the record is the
 * evidence of what SEFAZ said, the `MarketplaceInboxEvent.payload` habit.
 */
export interface FiscalDocumentEvent {
  readonly documentId: string;
  readonly kind: DocumentEventKind;
  readonly fromStatus: FiscalDocumentStatus;
  readonly toStatus: FiscalDocumentStatus;
  readonly at: string;
  readonly errorClass: SidecarErrorClass | null;
  readonly code: string | null;
  readonly answer: unknown;
}
