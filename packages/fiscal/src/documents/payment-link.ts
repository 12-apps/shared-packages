/**
 * The event 110300 "Vinculação Pagamento" (NT 2026.006 v1.00 §5.1): a payment
 * transaction linked to an authorised document after the fact — a Pix QR whose
 * txid was learnt only once the note was out, say. One event per transaction
 * (the event's single `gPgto`), numbered per document (`nSeqEvento`).
 *
 * Idempotent per `(document, transactionId)`: a transaction the document
 * already carries in its own `gPgtoVinc`, or already linked by an earlier
 * event, is skipped with no call to SEFAZ. A refusal answers the issuer's
 * failure and records nothing; the caller may ask again. `nSeqEvento` is the
 * next after the document's own recorded events; a 573 at it is settled by the
 * event SEFAZ holds there (its XML kept, its transaction recorded as its own),
 * and the payment is then sent at the next sequence.
 */

import type { IssuerFailure } from "../issuer/port";
import type { LinkedTransaction, PaymentLinkMeans } from "../sale/types";
import type { RegisteredPaymentLink } from "../sidecar/types";
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

/** Each 110300 the document's events record: the transaction and its `nSeqEvento`. */
function linkedByEvents(events: readonly FiscalDocumentEvent[]): Array<{ transactionId: string; sequence: number }> {
  return events
    .filter((event) => event.kind === "LINK_PAYMENT")
    .map((event, index) => {
      const answer = event.answer as { payment?: { transactionId?: unknown }; sequence?: unknown } | null;
      return {
        transactionId: answer?.payment?.transactionId,
        sequence: typeof answer?.sequence === "number" ? answer.sequence : index + 1,
      };
    })
    .filter((link): link is { transactionId: string; sequence: number } => typeof link.transactionId === "string");
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

/**
 * The transaction SEFAZ holds at the sequence just sent. A 135 registered what
 * was sent. A 573 answers the event already there, looked up: the same
 * transaction (a retry whose recording was lost), or another one, which is
 * then recorded as ITS link and never attributed to `sent`.
 */
function heldTransaction(answer: RegisteredPaymentLink, sent: LinkedTransaction, requested: readonly LinkedTransaction[]): LinkedTransaction {
  if (answer.statusCode !== "573" || answer.transaction.transactionId === sent.transactionId) return sent;
  const held = answer.transaction;
  return (
    requested.find((payment) => payment.transactionId === held.transactionId) ?? {
      transactionId: held.transactionId,
      meansCode: held.meansCode as PaymentLinkMeans,
      pspCnpjBase: held.pspCnpjBase,
      receiverCnpj: held.receiverCnpj,
    }
  );
}

/** One call's progress: the document as last advanced, the next `nSeqEvento`, what is linked. */
interface LinkRun {
  document: FiscalDocument;
  sequence: number;
  readonly known: Set<string>;
  readonly requested: readonly LinkedTransaction[];
  readonly linked: string[];
  readonly send: (sequence: number, payment: LinkedTransaction) => ReturnType<NonNullable<Deps["config"]["issuer"]["linkPayment"]>>;
}

function refuseOverLimit(document: FiscalDocument): never {
  throw new FiscalDocumentError("INVALID_INPUT", `document ${document.id} cannot take more than ${MAX_PAYMENT_LINKS} payment links.`);
}

/**
 * Sends `payment` at the run's sequence and records what SEFAZ holds there.
 * When that is another transaction (a 573), it is recorded as its own link and
 * `payment` goes out again at the next sequence. Answers the refusal, if any.
 */
async function sendOne(deps: Deps, run: LinkRun, accessKey: string, payment: LinkedTransaction): Promise<IssuerFailure | null> {
  if (run.sequence > MAX_PAYMENT_LINKS) refuseOverLimit(run.document);
  const sequence = run.sequence;
  const outcome = await run.send(sequence, payment);
  if (!outcome.ok) return outcome.error;
  const held = heldTransaction(outcome.answer, payment, run.requested);
  const { eventXml } = outcome.answer;
  const eventXmlKey = eventXml === null ? null : xmlKeys.linkPayment(accessKey, sequence);
  if (eventXmlKey !== null && eventXml !== null) await deps.config.storage.put(eventXmlKey, eventXml, "application/xml");
  run.document = await deps.ctx.advance(run.document, { kind: "LINK_PAYMENT", answer: outcome.answer, payment: held, sequence, eventXmlKey });
  run.known.add(held.transactionId);
  if (run.requested.some((one) => one.transactionId === held.transactionId)) run.linked.push(held.transactionId);
  run.sequence = sequence + 1;
  return held.transactionId === payment.transactionId ? null : sendOne(deps, run, accessKey, payment);
}

export async function linkPayment(deps: Deps, input: LinkPaymentInput): Promise<LinkPaymentResult> {
  const document = await deps.config.store.getDocument(input.ownerId, input.documentId);
  if (document === null) throw new FiscalDocumentError("NOT_FOUND", `owner ${input.ownerId} has no document ${input.documentId}.`);
  const { accessKey, protocol, send } = linkable(deps, document);
  const byEvents = linkedByEvents(await deps.config.store.listEvents(document.id));
  const known = new Set([...linkedInDocument(document), ...byEvents.map((link) => link.transactionId)]);
  const pending = input.payments.filter((payment) => !known.has(payment.transactionId));
  const alreadyLinked = input.payments.filter((payment) => known.has(payment.transactionId)).map((payment) => payment.transactionId);
  // `nSeqEvento` follows the document's own events, never a count of anything else.
  const sequence = Math.max(0, ...byEvents.map((link) => link.sequence)) + 1;
  if (sequence - 1 + pending.length > MAX_PAYMENT_LINKS) refuseOverLimit(document);
  if (pending.length === 0) return { linked: [], alreadyLinked, failure: null, document };
  const signing = await deps.ctx.material(await deps.ctx.requireProfile(input.ownerId));
  const run: LinkRun = {
    document,
    sequence,
    known,
    requested: pending,
    linked: [],
    send: (at, payment) => send({ model: document.model, environment: document.environment, signing, accessKey, protocol, sequence: at, payments: [payment] }),
  };
  for (const payment of pending) {
    if (run.known.has(payment.transactionId)) continue;
    const failure = await sendOne(deps, run, accessKey, payment);
    if (failure !== null) return { linked: run.linked, alreadyLinked, failure, document: run.document };
  }
  return { linked: run.linked, alreadyLinked, failure: null, document: run.document };
}
