/**
 * The fiscal document state machine: pure functions from a document and one
 * input to the next document and the event that records the step.
 *
 * ```
 *  PENDING ──SUBMIT──▶ SUBMITTED ──AUTHORIZE──▶ AUTHORIZED ──CANCEL──▶ CANCELLED
 *     │                   │ ├──DENY─────▶ DENIED
 *     │                   │ ├──REJECT───▶ REJECTED
 *     │                   │ └──RETRY────▶ SUBMITTED
 *     │                   └──REPLACE──▶ REPLACED
 *     ├──REPLACE──▶ REPLACED
 *     └──SIGN_OFFLINE──▶ CONTINGENCY ──AUTHORIZE | DENY | REJECT | RETRY──▶ …
 * ```
 *
 * A document is one number, so going offline is a SECOND document on the
 * issuing point's contingency series (`PENDING → CONTINGENCY`), and the first
 * one is `REPLACED`. Every input yields an event, a refused one yields a
 * {@link FiscalDocumentError} `TRANSITION_REFUSED` and changes nothing:
 * `CANCELLED` from anything but `AUTHORIZED`, and `AUTHORIZED` from a final
 * state (`REJECTED`, `DENIED`, `CANCELLED`, `REPLACED`), are refused.
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
import { FiscalDocumentError } from "./errors";
import type { DocumentEventKind, FiscalDocument, FiscalDocumentEvent, FiscalDocumentStatus, NumberVoid } from "./types";

type SidecarError = SidecarErrorBody["error"];

/** What the machine is fed. Each carries the service's answer, which the event keeps. */
export type DocumentInput =
  | { readonly kind: "SUBMIT" }
  | { readonly kind: "AUTHORIZE"; readonly answer: IssuedDocument; readonly xmlKey: string }
  | { readonly kind: "DENY"; readonly answer: IssuedDocument; readonly xmlKey: string }
  | { readonly kind: "REJECT"; readonly error: SidecarError }
  | { readonly kind: "RETRY"; readonly error: SidecarError }
  | {
      readonly kind: "SIGN_OFFLINE";
      readonly answer: ContingencySignedDocument;
      readonly contingency: ContingencyEntry;
      readonly xmlKey: string;
    }
  | { readonly kind: "REPLACE"; readonly replacedById: string }
  | { readonly kind: "CANCEL"; readonly answer: CancelledDocument; readonly reason: string; readonly eventXmlKey: string | null }
  | { readonly kind: "LOOKUP"; readonly answer: LookedUpDocument }
  | { readonly kind: "INUTILIZE"; readonly answer: InutilizedRange; readonly eventXmlKey: string | null };

/** From which states each input is accepted. */
export const DOCUMENT_TRANSITIONS: Readonly<Record<DocumentEventKind, readonly FiscalDocumentStatus[]>> = {
  SUBMIT: ["PENDING"],
  AUTHORIZE: ["SUBMITTED", "CONTINGENCY"],
  DENY: ["SUBMITTED", "CONTINGENCY"],
  REJECT: ["SUBMITTED", "CONTINGENCY"],
  RETRY: ["SUBMITTED", "CONTINGENCY"],
  SIGN_OFFLINE: ["PENDING"],
  REPLACE: ["PENDING", "SUBMITTED"],
  CANCEL: ["AUTHORIZED", "REPLACED"],
  LOOKUP: ["SUBMITTED", "AUTHORIZED", "REPLACED"],
  INUTILIZE: ["REJECTED", "REPLACED"],
};

/** The states nothing but a lookup, a cancel or an inutilization of the number may follow. */
export const FINAL_STATUSES: readonly FiscalDocumentStatus[] = ["REJECTED", "DENIED", "CANCELLED", "REPLACED"];

export interface Transition {
  readonly document: FiscalDocument;
  readonly event: FiscalDocumentEvent;
}

const SECRET_KEY = /^(pfx|pfxBase64|password|passphrase|certificate|csc|token|privateKey)$/i;

/**
 * A copy of an answer with every secret-named key dropped. The service never
 * echoes one; this is the second lock, so an event row can never hold one.
 */
export function scrubSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubSecrets);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!SECRET_KEY.test(key)) out[key] = scrubSecrets(inner);
  }
  return out;
}

function refuse(document: FiscalDocument, kind: DocumentEventKind, why: string): never {
  throw new FiscalDocumentError(
    "TRANSITION_REFUSED",
    `${kind} is refused on document ${document.id} in ${document.status}: ${why}.`,
  );
}

function issuedFields(answer: IssuedDocument, xmlKey: string): Partial<FiscalDocument> {
  return {
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

function failedFields(document: FiscalDocument, error: SidecarError): Partial<FiscalDocument> {
  return {
    accessKey: error.accessKey ?? document.accessKey,
    statusCode: error.code,
    statusReason: error.message,
    lastErrorClass: error.class,
    outcomeUnknown: error.outcomeUnknown,
  };
}

/** What a lookup of a replaced document says is owed on its number. */
function voidAfterLookup(answer: LookedUpDocument): NumberVoid | null {
  if (answer.status === "NOT_FOUND") return "INUTILIZE";
  if (answer.status === "AUTHORIZED") return "CANCEL";
  if (answer.status === "CANCELLED") return "CANCELLED";
  return null;
}

function lookupFields(document: FiscalDocument, answer: LookedUpDocument): Partial<FiscalDocument> {
  if (document.status === "REPLACED") {
    if (document.numberVoid !== "LOOKUP_FIRST") refuse(document, "LOOKUP", "its number is already settled");
    return { numberVoid: voidAfterLookup(answer), outcomeUnknown: false };
  }
  if (document.status === "AUTHORIZED" && answer.status === "CANCELLED") {
    return { status: "CANCELLED", statusCode: answer.statusCode, statusReason: answer.statusReason };
  }
  return { statusCode: answer.statusCode, statusReason: answer.statusReason };
}

function cancelFields(document: FiscalDocument, input: Extract<DocumentInput, { kind: "CANCEL" }>): Partial<FiscalDocument> {
  const recorded = {
    cancelledAt: input.answer.registeredAt,
    cancelReason: input.reason,
    cancelProtocol: input.answer.protocol,
    eventXmlKey: input.eventXmlKey,
  };
  if (document.status === "REPLACED") {
    if (document.numberVoid !== "CANCEL") refuse(document, "CANCEL", "a replaced document is cancelled only when found authorised");
    return { ...recorded, numberVoid: "CANCELLED" };
  }
  return { ...recorded, status: "CANCELLED", statusCode: input.answer.statusCode, statusReason: input.answer.statusReason };
}

type InputOf<K extends DocumentEventKind> = Extract<DocumentInput, { kind: K }>;
type Step = { readonly [K in DocumentEventKind]: (document: FiscalDocument, input: InputOf<K>) => Partial<FiscalDocument> };

const STEPS: Step = {
  SUBMIT: () => ({ status: "SUBMITTED" }),
  AUTHORIZE: (_document, input) => ({ status: "AUTHORIZED", ...issuedFields(input.answer, input.xmlKey) }),
  DENY: (_document, input) => ({ status: "DENIED", ...issuedFields(input.answer, input.xmlKey) }),
  REJECT: (document, input) => ({ status: "REJECTED", ...failedFields(document, input.error), numberVoid: "INUTILIZE" }),
  RETRY: (document, input) => failedFields(document, input.error),
  SIGN_OFFLINE: (document, input) => {
    if (document.seriesKind !== "CONTINGENCY") refuse(document, input.kind, "only a contingency-series number is signed offline");
    return { status: "CONTINGENCY", accessKey: input.answer.accessKey, contingency: input.contingency, xmlKey: input.xmlKey };
  },
  REPLACE: (document, input) => ({
    status: "REPLACED",
    replacedById: input.replacedById,
    // A key means the call got as far as signing: SEFAZ may hold it.
    numberVoid: document.status === "SUBMITTED" && document.outcomeUnknown && document.accessKey !== null ? "LOOKUP_FIRST" : "INUTILIZE",
  }),
  CANCEL: cancelFields,
  LOOKUP: (document, input) => lookupFields(document, input.answer),
  INUTILIZE: (document, input) => {
    if (document.numberVoid !== "INUTILIZE") refuse(document, input.kind, "its number is not owed an inutilization");
    return { numberVoid: "INUTILIZED", eventXmlKey: input.eventXmlKey };
  },
};

function next(document: FiscalDocument, input: DocumentInput): Partial<FiscalDocument> {
  const step = STEPS[input.kind] as (document: FiscalDocument, input: DocumentInput) => Partial<FiscalDocument>;
  return step(document, input);
}

function answerOf(input: DocumentInput): unknown {
  if ("answer" in input) return input.answer;
  if ("error" in input) return { error: input.error };
  return null;
}

function eventOf(document: FiscalDocument, input: DocumentInput, toStatus: FiscalDocumentStatus, at: string): FiscalDocumentEvent {
  const error = "error" in input ? input.error : null;
  const answer = "answer" in input ? input.answer : null;
  return {
    documentId: document.id,
    kind: input.kind,
    fromStatus: document.status,
    toStatus,
    at,
    errorClass: error?.class ?? null,
    code: error?.code ?? (answer !== null && "statusCode" in answer ? answer.statusCode : null),
    answer: scrubSecrets(answerOf(input)),
  };
}

/**
 * Apply one input. Throws `TRANSITION_REFUSED` (and changes nothing) when the
 * document's state does not accept it. `at` is the caller's clock, ISO 8601.
 */
export function transition(document: FiscalDocument, input: DocumentInput, at: string): Transition {
  if (!DOCUMENT_TRANSITIONS[input.kind].includes(document.status)) {
    refuse(document, input.kind, `accepted only from ${DOCUMENT_TRANSITIONS[input.kind].join(", ")}`);
  }
  const counts = input.kind === "SUBMIT" || input.kind === "RETRY" || input.kind === "SIGN_OFFLINE";
  const updated: FiscalDocument = {
    ...document,
    ...next(document, input),
    attempts: document.attempts + (counts ? 1 : 0),
    updatedAt: at,
  };
  return { document: updated, event: eventOf(document, input, updated.status, at) };
}

/** Whether an input would be accepted, without applying it. */
export function canTransition(status: FiscalDocumentStatus, kind: DocumentEventKind): boolean {
  return DOCUMENT_TRANSITIONS[kind].includes(status);
}
