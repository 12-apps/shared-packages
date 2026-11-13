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
 *                          ▲ REJECTED (contingency) ──RESIGN──┘
 * ```
 *
 * A document is one number, so going offline is a SECOND document on the
 * issuing point's contingency series (`PENDING → CONTINGENCY`), and the first
 * one is `REPLACED`. Every input yields an event; a refused one throws
 * {@link FiscalDocumentError} `TRANSITION_REFUSED` and changes nothing:
 * `CANCELLED` is entered only from `AUTHORIZED`, and `AUTHORIZED` never from a
 * final state. A rejected contingency NFC-e is the one way back: the store
 * corrects it and it is signed again under the same number (`RESIGN`).
 *
 * `DEFER`, `RELEASE` and `WARN` record what the sweep and a person did without
 * changing the state: a failed step counts toward {@link MAX_FAILURES}, after
 * which the document waits for a person (`attention`).
 */

import { type DocumentInput, STEPS, refuse } from "./machine-steps";
import type { DocumentEventKind, FiscalDocument, FiscalDocumentEvent, FiscalDocumentStatus } from "./types";

export { MAX_FAILURES } from "./machine-steps";
export type { DocumentInput } from "./machine-steps";

const ANY: readonly FiscalDocumentStatus[] = [
  "PENDING", "SUBMITTED", "AUTHORIZED", "REJECTED", "DENIED", "CONTINGENCY", "CANCELLED", "REPLACED",
];

/** From which states each input is accepted. */
export const DOCUMENT_TRANSITIONS: Readonly<Record<DocumentEventKind, readonly FiscalDocumentStatus[]>> = {
  SUBMIT: ["PENDING"],
  AUTHORIZE: ["SUBMITTED", "CONTINGENCY"],
  DENY: ["SUBMITTED", "CONTINGENCY"],
  REJECT: ["SUBMITTED", "CONTINGENCY"],
  RETRY: ["SUBMITTED", "CONTINGENCY"],
  SIGN_OFFLINE: ["PENDING"],
  REPLACE: ["PENDING", "SUBMITTED"],
  CANCEL: ["AUTHORIZED", "REPLACED", "REJECTED"],
  LOOKUP: ["SUBMITTED", "AUTHORIZED", "REPLACED", "REJECTED"],
  INUTILIZE: ["REJECTED", "REPLACED"],
  DEFER: ANY,
  RESIGN: ["REJECTED"],
  RELEASE: ANY,
  WARN: ["CONTINGENCY"],
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

function answerOf(input: DocumentInput): unknown {
  if ("answer" in input) return input.answer;
  if ("error" in input && input.error !== null) return { error: input.error };
  if (input.kind === "DEFER") return { reason: input.reason };
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

const COUNTED = new Set<DocumentEventKind>(["SUBMIT", "RETRY", "SIGN_OFFLINE", "RESIGN"]);

/**
 * Apply one input. Throws `TRANSITION_REFUSED` (and changes nothing) when the
 * document's state does not accept it. `at` is the caller's clock, ISO 8601.
 */
export function transition(document: FiscalDocument, input: DocumentInput, at: string): Transition {
  if (!DOCUMENT_TRANSITIONS[input.kind].includes(document.status)) {
    refuse(document, input.kind, `accepted only from ${DOCUMENT_TRANSITIONS[input.kind].join(", ")}`);
  }
  const step = STEPS[input.kind] as (document: FiscalDocument, input: DocumentInput) => Partial<FiscalDocument>;
  const updated: FiscalDocument = {
    ...document,
    ...step(document, input),
    ...(input.kind === "WARN" ? { deadlineWarnedAt: at } : {}),
    attempts: document.attempts + (COUNTED.has(input.kind) ? 1 : 0),
    updatedAt: at,
  };
  return { document: updated, event: eventOf(document, input, updated.status, at) };
}

/** Whether an input would be accepted, without applying it. */
export function canTransition(status: FiscalDocumentStatus, kind: DocumentEventKind): boolean {
  return DOCUMENT_TRANSITIONS[kind].includes(status);
}

