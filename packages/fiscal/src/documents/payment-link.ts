/**
 * The event 110300 "Vinculação Pagamento" (NT 2026.006 v1.00 §5.1): a payment
 * transaction linked to an authorised document after the fact — a Pix QR whose
 * txid was learnt only once the note was out, say. One event per transaction
 * (the event's single `gPgto`), numbered per document (`nSeqEvento`).
 *
 * Idempotent per `(document, transactionId)`: a transaction the document
 * already carries in its own `gPgtoVinc`, or already linked by an earlier
 * event, is skipped with no call to SEFAZ. A refusal answers the issuer's
 * failure and records nothing; the caller may ask again.
 */

import type { IssuerFailure } from "../issuer/port";
import type { LinkedTransaction } from "../sale/types";
import { xmlKeys } from "./context";
import { FiscalDocumentError } from "./errors";
import type { Deps } from "./service-profile";
import type { FiscalDocument, FiscalDocumentEvent } from "./types";

/** `nSeqEvento` runs 1–20 per event type and document. */
export const MAX_PAYMENT_LINKS = 20;

export interface LinkPaymentInput {
  readonly ownerId: string;
  readonly documentId: string;
  readonly payments: readonly LinkedTransaction[];
}

export interface LinkPaymentResult {
  /** The transaction ids SEFAZ registered in this call. */
  readonly linked: readonly string[];
  /** Those the document already carried or an earlier event linked: nothing was sent. */
  readonly alreadyLinked: readonly string[];
  /** The first refusal, if any; the transactions after it were not sent. */
  readonly failure: IssuerFailure | null;
  readonly document: FiscalDocument;
}

/** The transaction ids an event of the document already linked. */
function linkedByEvents(events: readonly FiscalDocumentEvent[]): string[] {
  return events
    .filter((event) => event.kind === "LINK_PAYMENT")
    .map((event) => (event.answer as { payment?: { transactionId?: unknown } } | null)?.payment?.transactionId)
    .filter((id): id is string => typeof id === "string");
}

/** The transaction ids the document's own `gPgtoVinc` carries. */
function linkedInDocument(document: FiscalDocument): string[] {
  return document.sale.payments
    .map((payment) => payment.linkedTransaction?.transactionId)
    .filter((id): id is string => typeof id === "string");
}

/** What every event of this document is sent with: its key, its protocol and the issuer's event call. */
function linkable(deps: Deps, document: FiscalDocument) {
  const { accessKey, protocol } = document;
  if (document.status !== "AUTHORIZED" || accessKey === null || protocol === null) {
    throw new FiscalDocumentError("TRANSITION_REFUSED", `document ${document.id} is ${document.status}; only an authorised document is linked.`);
  }
  const send = deps.config.issuer.linkPayment;
  if (typeof send !== "function") throw new FiscalDocumentError("NOT_SUPPORTED", "this issuer does not register the event 110300.");
  return { accessKey, protocol, send: send.bind(deps.config.issuer) };
}

export async function linkPayment(deps: Deps, input: LinkPaymentInput): Promise<LinkPaymentResult> {
  let document = await deps.config.store.getDocument(input.ownerId, input.documentId);
  if (document === null) throw new FiscalDocumentError("NOT_FOUND", `owner ${input.ownerId} has no document ${input.documentId}.`);
  const { accessKey, protocol, send } = linkable(deps, document);
  const byEvents = linkedByEvents(await deps.config.store.listEvents(document.id));
  const known = new Set([...linkedInDocument(document), ...byEvents]);
  const pending = input.payments.filter((payment) => !known.has(payment.transactionId));
  const alreadyLinked = input.payments.filter((payment) => known.has(payment.transactionId)).map((payment) => payment.transactionId);
  if (byEvents.length + pending.length > MAX_PAYMENT_LINKS) {
    throw new FiscalDocumentError("INVALID_INPUT", `document ${document.id} cannot take more than ${MAX_PAYMENT_LINKS} payment links.`);
  }
  const linked: string[] = [];
  const signing = pending.length === 0 ? null : await deps.ctx.material(await deps.ctx.requireProfile(input.ownerId));
  for (const payment of pending) {
    const sequence = byEvents.length + linked.length + 1;
    const outcome = await send({ model: document.model, environment: document.environment, signing: signing!, accessKey, protocol, sequence, payment });
    if (!outcome.ok) return { linked, alreadyLinked, failure: outcome.error, document };
    const { eventXml } = outcome.answer;
    const eventXmlKey = eventXml === null ? null : xmlKeys.linkPayment(accessKey, sequence);
    if (eventXmlKey !== null && eventXml !== null) await deps.config.storage.put(eventXmlKey, eventXml, "application/xml");
    document = await deps.ctx.advance(document, { kind: "LINK_PAYMENT", answer: outcome.answer, payment, eventXmlKey });
    linked.push(payment.transactionId);
  }
  return { linked, alreadyLinked, failure: null, document };
}
