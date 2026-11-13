/**
 * What each input does to a document's fields — the state machine's body
 * (`./machine` holds its table and its one entry point). Pure functions; a
 * refusal throws `TRANSITION_REFUSED`.
 */

import type {
  CancelledDocument,
  ContingencyEntry,
  ContingencySignedDocument,
  InutilizedRange,
  IssuedDocument,
  LookedUpDocument,
  SidecarErrorBody,
} from "../sidecar/types";
import type { SaleForDocument } from "../sale/types";
import { FiscalDocumentError } from "./errors";
import { type DocumentEventKind, type DocumentTotals, type FiscalDocument, type NumberVoid, isLive } from "./types";

export type SidecarError = SidecarErrorBody["error"];

/** Failures in a row after which a document waits for a person. */
export const MAX_FAILURES = 8;

/** What the machine is fed. Each carries the service's answer, which the event keeps. */
export type DocumentInput =
  | { readonly kind: "SUBMIT" }
  | { readonly kind: "AUTHORIZE"; readonly answer: IssuedDocument; readonly xmlKey: string }
  | { readonly kind: "DENY"; readonly answer: IssuedDocument; readonly xmlKey: string }
  | { readonly kind: "REJECT"; readonly error: SidecarError }
  /** `xmlKey`: where the signed XML the failed call returned was stored, when it returned one. */
  | { readonly kind: "RETRY"; readonly error: SidecarError; readonly xmlKey?: string }
  | {
      readonly kind: "SIGN_OFFLINE";
      readonly answer: ContingencySignedDocument;
      readonly contingency: ContingencyEntry;
      readonly xmlKey: string;
    }
  | { readonly kind: "REPLACE"; readonly replacedById: string }
  | { readonly kind: "CANCEL"; readonly answer: CancelledDocument; readonly reason: string; readonly eventXmlKey: string | null }
  /**
   * `xmlKey`: the `nfeProc` assembled from the stored signed XML and the
   * lookup's protocol. Without it a lookup never makes a SUBMITTED document
   * final: an authorised document always has its XML.
   */
  | { readonly kind: "LOOKUP"; readonly answer: LookedUpDocument; readonly xmlKey?: string }
  | { readonly kind: "INUTILIZE"; readonly answer: InutilizedRange; readonly eventXmlKey: string | null }
  /**
   * A step that made no progress (a settlement refused or unanswered, a step
   * that threw). It counts a failure; `attention` hands the document to a
   * person at once (SEFAZ refused it: retrying would only repeat the refusal).
   */
  | { readonly kind: "DEFER"; readonly reason: string; readonly error: SidecarError | null; readonly attention: boolean }
  /** A rejected contingency NFC-e, corrected by the store and signed again under the same number. */
  | {
      readonly kind: "RESIGN";
      readonly answer: ContingencySignedDocument;
      readonly sale: SaleForDocument;
      readonly totals: DocumentTotals;
      readonly buyerTaxId: string | null;
      readonly xmlKey: string;
    }
  /** A person took a document back from `attention`: the sweep may try again. */
  | { readonly kind: "RELEASE" }
  /** The 24-hour contingency deadline warning went out. */
  | { readonly kind: "WARN" };

type InputOf<K extends DocumentEventKind> = Extract<DocumentInput, { kind: K }>;
type Step = { readonly [K in DocumentEventKind]: (document: FiscalDocument, input: InputOf<K>) => Partial<FiscalDocument> };

export function refuse(document: FiscalDocument, kind: DocumentEventKind, why: string): never {
  throw new FiscalDocumentError(
    "TRANSITION_REFUSED",
    `${kind} is refused on document ${document.id} in ${document.status}: ${why}.`,
  );
}

/** Progress: the failure count, the person's flag and the unknown outcome are settled. */
const SETTLED = { failures: 0, attention: false } as const;

function issuedFields(answer: IssuedDocument, xmlKey: string): Partial<FiscalDocument> {
  return {
    ...SETTLED,
    accessKey: answer.accessKey,
    protocol: answer.protocol,
    authorizedAt: answer.authorizedAt,
    statusCode: answer.statusCode,
    statusReason: answer.statusReason,
    lastErrorClass: null,
    outcomeUnknown: false,
    xmlKey,
  };
}

/**
 * A failed call. `outcomeUnknown` is STICKY: once a request may have reached
 * SEFAZ unanswered, only a definitive answer or a lookup clears it — a later
 * "nothing was sent this time" says nothing about the first send.
 */
function failedFields(document: FiscalDocument, error: SidecarError): Partial<FiscalDocument> {
  return {
    accessKey: document.accessKey ?? error.accessKey,
    statusCode: error.code,
    statusReason: error.message,
    lastErrorClass: error.class,
    outcomeUnknown: document.outcomeUnknown || error.outcomeUnknown,
  };
}

function failure(document: FiscalDocument, attention: boolean): Partial<FiscalDocument> {
  const failures = document.failures + 1;
  return { failures, attention: attention || failures >= MAX_FAILURES };
}

/** What a lookup says is owed on a number SEFAZ may hold. */
function voidAfterLookup(answer: LookedUpDocument): NumberVoid {
  if (answer.status === "AUTHORIZED") return "CANCEL";
  if (answer.status === "CANCELLED") return "CANCELLED";
  if (answer.status === "DENIED") return "DENIED";
  return "INUTILIZE";
}

function lookupOfSettledNumber(document: FiscalDocument, answer: LookedUpDocument): Partial<FiscalDocument> {
  if (document.numberVoid !== "LOOKUP_FIRST") refuse(document, "LOOKUP", "its number is already settled");
  if (isLive(document) && (answer.status === "AUTHORIZED" || answer.status === "DENIED")) {
    // The sale's own document, still SEFAZ's: never cancelled, never voided,
    // never left REJECTED. It goes back to SUBMITTED, owing work, with the
    // protocol kept — the next step settles it with its XML (the service does
    // at once when it holds the XML the protocol certifies; otherwise the
    // sweep sends the same call again, which the fiscal service settles).
    // Its failures keep counting, so a loop of refusals reaches a person.
    return {
      status: "SUBMITTED",
      numberVoid: null,
      outcomeUnknown: false,
      protocol: answer.protocol ?? document.protocol,
      statusCode: answer.statusCode,
      statusReason: answer.statusReason,
    };
  }
  return {
    ...SETTLED,
    numberVoid: voidAfterLookup(answer),
    outcomeUnknown: false,
    // The protocol SEFAZ answered is what a cancel of this number must quote.
    protocol: answer.protocol ?? document.protocol,
    statusCode: answer.statusCode,
    statusReason: answer.statusReason,
  };
}

/**
 * A lookup of a SUBMITTED document. It settles it as AUTHORIZED or DENIED
 * only with the XML in hand (`xmlKey`); otherwise it keeps what SEFAZ said —
 * the protocol marks the number as SEFAZ's — and the document stays
 * SUBMITTED, for the sweep to fetch the XML by sending the same call again.
 */
function lookupOfSubmitted(document: FiscalDocument, answer: LookedUpDocument, xmlKey: string | undefined): Partial<FiscalDocument> {
  const known = { statusCode: answer.statusCode, statusReason: answer.statusReason, outcomeUnknown: false };
  // A key found cancelled elsewhere is left to the next issue call, which the service settles: CANCELLED is entered only from AUTHORIZED.
  const settles = answer.status === "AUTHORIZED" || answer.status === "DENIED";
  if (!settles || answer.protocol === null || document.accessKey === null) return known;
  if (xmlKey === undefined) return { ...known, protocol: answer.protocol };
  return { ...known, ...SETTLED, status: answer.status, protocol: answer.protocol, lastErrorClass: null, xmlKey };
}

function lookupFields(document: FiscalDocument, answer: LookedUpDocument, xmlKey?: string): Partial<FiscalDocument> {
  if (document.status === "REPLACED" || document.status === "REJECTED") return lookupOfSettledNumber(document, answer);
  if (document.status === "SUBMITTED") return lookupOfSubmitted(document, answer, xmlKey);
  if (answer.status === "CANCELLED") return { status: "CANCELLED", statusCode: answer.statusCode, statusReason: answer.statusReason };
  return { statusCode: answer.statusCode, statusReason: answer.statusReason };
}

function cancelFields(document: FiscalDocument, input: InputOf<"CANCEL">): Partial<FiscalDocument> {
  const recorded = {
    ...SETTLED,
    cancelledAt: input.answer.registeredAt,
    cancelReason: input.reason,
    cancelProtocol: input.answer.protocol,
    eventXmlKey: input.eventXmlKey,
  };
  if (document.status === "AUTHORIZED") {
    return { ...recorded, status: "CANCELLED", statusCode: input.answer.statusCode, statusReason: input.answer.statusReason };
  }
  if (document.numberVoid !== "CANCEL") refuse(document, "CANCEL", "a voided number is cancelled only when found authorised");
  return { ...recorded, numberVoid: "CANCELLED" };
}

/** A rejected online number may have been authorised by an unanswered first send: look it up first. */
/**
 * A rejected online number may have been authorised by an unanswered first
 * send — or a lookup already found it authorised (its protocol is kept, and
 * a re-send for the XML met a 704 or a different XML under the key): either
 * way it is looked up, never voided blindly.
 */
function rejectFields(document: FiscalDocument, error: SidecarError): Partial<FiscalDocument> {
  const failed = failedFields(document, error);
  if (document.seriesKind === "CONTINGENCY") return { status: "REJECTED", ...failed, ...SETTLED, numberVoid: null };
  // Known to be SEFAZ's: a refused re-send is one more failure of the same document, not a settlement.
  if (document.protocol !== null) return { status: "REJECTED", ...failed, ...failure(document, false), numberVoid: "LOOKUP_FIRST" };
  return { status: "REJECTED", ...failed, ...SETTLED, numberVoid: failed.outcomeUnknown === true ? "LOOKUP_FIRST" : "INUTILIZE" };
}

export const STEPS: Step = {
  SUBMIT: () => ({ status: "SUBMITTED" }),
  AUTHORIZE: (_document, input) => ({ status: "AUTHORIZED", ...issuedFields(input.answer, input.xmlKey) }),
  DENY: (_document, input) => ({ status: "DENIED", ...issuedFields(input.answer, input.xmlKey) }),
  REJECT: (document, input) => rejectFields(document, input.error),
  RETRY: (document, input) => ({
    ...failedFields(document, input.error),
    ...failure(document, false),
    ...(input.xmlKey === undefined ? {} : { xmlKey: input.xmlKey }),
  }),
  SIGN_OFFLINE: (document, input) => {
    if (document.seriesKind !== "CONTINGENCY") refuse(document, input.kind, "only a contingency-series number is signed offline");
    return { ...SETTLED, status: "CONTINGENCY", accessKey: input.answer.accessKey, contingency: input.contingency, xmlKey: input.xmlKey };
  },
  REPLACE: (document, input) => ({
    ...SETTLED,
    status: "REPLACED",
    replacedById: input.replacedById,
    // A SUBMITTED document may have reached SEFAZ whatever was recorded (a process
    // that died mid-call, a receipt with no protocol yet): its key is always
    // known, so it is looked up before its number is voided. Only a PENDING one
    // was never sent.
    numberVoid: document.status === "SUBMITTED" ? "LOOKUP_FIRST" : "INUTILIZE",
  }),
  CANCEL: cancelFields,
  LOOKUP: (document, input) => lookupFields(document, input.answer, input.xmlKey),
  INUTILIZE: (document, input) => {
    if (document.numberVoid !== "INUTILIZE") refuse(document, input.kind, "its number is not owed an inutilization");
    return { ...SETTLED, numberVoid: "INUTILIZED", eventXmlKey: input.eventXmlKey };
  },
  DEFER: (document, input) => ({
    ...failure(document, input.attention),
    ...(input.error === null ? {} : { lastErrorClass: input.error.class, statusCode: input.error.code }),
    statusReason: input.error?.message ?? input.reason,
  }),
  RESIGN: (document, input) => {
    if (document.seriesKind !== "CONTINGENCY") refuse(document, input.kind, "only a rejected contingency NFC-e is resent");
    return {
      ...SETTLED,
      status: "CONTINGENCY",
      sale: input.sale,
      totals: input.totals,
      buyerTaxId: input.buyerTaxId,
      accessKey: input.answer.accessKey,
      xmlKey: input.xmlKey,
      statusCode: null,
      statusReason: null,
      lastErrorClass: null,
    };
  },
  RELEASE: (document) => {
    if (!document.attention) refuse(document, "RELEASE", "it is not waiting for a person");
    return SETTLED;
  },
  // `deadlineWarnedAt` is the transition's own time, set by `transition`.
  WARN: () => ({}),
};
