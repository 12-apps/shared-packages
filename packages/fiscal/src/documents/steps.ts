/**
 * The steps that issue a document, each one call and the transition its
 * answer earns. The mapping of the service's classes:
 *
 * | answer | on a document being issued | on a contingency document being transmitted |
 * |---|---|---|
 * | `AUTHORIZED` / `DENIED` | AUTHORIZE / DENY | AUTHORIZE / DENY |
 * | `REJECTED`, `INVALID`, `INTERNAL` | REJECT: the number is voided (looked up first if a send went unanswered) | REJECT: kept for the store to correct and resend |
 * | `CONTINGENCY`, NFC-e, point with a contingency series | a second document, offline, replacing this one in one transaction | RETRY |
 * | `CONTINGENCY` otherwise, `RETRYABLE`, `AUTH` | RETRY, with backoff; a person after `MAX_FAILURES` | RETRY |
 *
 * An online NFC-e is never sent again past `nfceOnlineToleranceMs` (SEFAZ
 * refuses a late `dhEmi`): where the point has a contingency series it goes
 * offline instead.
 *
 * A caller that cannot wait (a counter whose paper waits for the note) gives
 * the send an ONLINE DEADLINE (`issue({ …, onlineDeadlineMs })`): an NFC-e at
 * a point with a contingency series whose send is not answered by then — or is
 * answered with no answer (`RETRYABLE`) — goes offline at once, exactly as a
 * `CONTINGENCY` answer does. The send may still have reached SEFAZ, so the
 * replaced number is marked unknown and looked up before it is voided; its
 * late answer settles nothing.
 */

import type { IssuerFailure, IssuerOutcome, SigningMaterial } from "../issuer/port";
import { FISCAL_ISSUE } from "../manifest/permissions";
import type { IssuedDocument } from "../sidecar/types";
import { FISCAL_DOCUMENT_REJECTED, type FiscalContext, draftOf, xmlKeys } from "./context";
import { FiscalDocumentError } from "./errors";
import { computeAccessKey } from "./helpers";
import { digestOf } from "./nfe-proc";
import type { EmitterProfile, IssuingPoint } from "./profile";
import type { FiscalDocument } from "./types";

const FINAL_FAILURES = new Set<IssuerFailure["class"]>(["REJECTED", "INVALID", "INTERNAL"]);

async function reject(ctx: FiscalContext, document: FiscalDocument, error: IssuerFailure): Promise<FiscalDocument> {
  const rejected = await ctx.advance(document, { kind: "REJECT", error });
  await ctx.config.notify.emit({
    type: FISCAL_DOCUMENT_REJECTED,
    recipient: { tenantId: document.ownerId, permission: FISCAL_ISSUE },
    payload: {
      documentId: document.id,
      subjectId: document.subjectId,
      model: document.model,
      series: document.series,
      number: document.number,
      code: error.code,
      reason: error.message,
    },
  });
  return rejected;
}

async function accept(ctx: FiscalContext, document: FiscalDocument, answer: IssuedDocument): Promise<FiscalDocument> {
  const xmlKey = xmlKeys.authorized(answer.accessKey);
  await ctx.config.storage.put(xmlKey, answer.authorizedXml, "application/xml");
  return ctx.advance(document, { kind: answer.status === "AUTHORIZED" ? "AUTHORIZE" : "DENY", answer, xmlKey });
}

function canGoOffline(document: FiscalDocument, point: IssuingPoint): boolean {
  return document.model === "NFCE" && document.seriesKind === "ONLINE" && point.contingencySeries !== null;
}

/** An online NFC-e whose `dhEmi` SEFAZ would now refuse as late. */
function pastOnlineTolerance(ctx: FiscalContext, document: FiscalDocument): boolean {
  return ctx.config.now().getTime() - Date.parse(document.createdAt) > ctx.config.nfceOnlineToleranceMs;
}

/** Sign a contingency-series document offline. On a failure it is left as it was, for the caller to defer. */
async function signOffline(
  ctx: FiscalContext,
  document: FiscalDocument,
  profile: EmitterProfile,
  signing: SigningMaterial,
): Promise<{ document: FiscalDocument; error: IssuerFailure | null }> {
  const contingency = { since: await ctx.localNow(profile.ownerId), reason: ctx.config.reasons.contingency };
  const outcome = await ctx.config.issuer.signContingency({ environment: document.environment, signing, document: document.sale, contingency });
  if (!outcome.ok) return { document, error: outcome.error };
  const xmlKey = xmlKeys.signed(outcome.answer.accessKey);
  await ctx.config.storage.put(xmlKey, outcome.answer.signedXml, "application/xml");
  return { document: await ctx.advance(document, { kind: "SIGN_OFFLINE", answer: outcome.answer, contingency, xmlKey }), error: null };
}

/** Sign a PENDING contingency document; a failure is deferred (it stays PENDING, the sweep signs it later). */
export async function signPending(
  ctx: FiscalContext,
  document: FiscalDocument,
  profile: EmitterProfile,
  signing: SigningMaterial,
): Promise<FiscalDocument> {
  const signed = await signOffline(ctx, document, profile, signing);
  if (signed.error === null) return signed.document;
  return ctx.advance(document, {
    kind: "DEFER",
    reason: "signing offline failed",
    error: signed.error,
    // Signing is local: a certificate that does not open (AUTH) will not open on the next try either.
    attention: FINAL_FAILURES.has(signed.error.class) || signed.error.class === "AUTH",
  });
}

/**
 * Move the sale offline: number a second document on the contingency series
 * AND replace this one, in ONE transaction, before anything is signed — so a
 * crash can never leave the online document to be sent again beside its twin.
 * Signing follows; if it fails, the new document waits PENDING for the sweep.
 */
async function goOffline(
  ctx: FiscalContext,
  document: FiscalDocument,
  profile: EmitterProfile,
  point: IssuingPoint,
  signing: SigningMaterial,
): Promise<FiscalDocument> {
  const offline = await ctx.createNumbered({
    profile,
    point,
    subjectId: document.subjectId,
    model: document.model,
    seriesKind: "CONTINGENCY",
    draft: draftOf(document.sale),
    replacing: document,
  });
  return signPending(ctx, offline, profile, signing);
}

/**
 * The signed XML a failed call returned, stored UNDER ITS DIGEST and never
 * over another: each send under a key may carry a different XML (a service
 * upgrade between sends changes `verProc`, say), and only the one SEFAZ
 * authorised may become the `nfeProc`. A lookup reads the protocol's `digVal`
 * and fetches exactly that XML (`xmlKeys.signedByDigest`), so pairing is by
 * digest, not by "the last one stored". `xmlKey` points at the latest.
 */
async function keepSigned(ctx: FiscalContext, document: FiscalDocument, error: IssuerFailure): Promise<{ xmlKey?: string }> {
  const key = document.accessKey ?? error.accessKey;
  const digest = error.signedXml === null ? null : digestOf(error.signedXml);
  if (error.signedXml === null || key === null || digest === null) return {};
  const xmlKey = xmlKeys.signedByDigest(key, digest);
  await ctx.config.storage.put(xmlKey, error.signedXml, "application/xml");
  return { xmlKey };
}

/**
 * An online NFC-e SEFAZ would now refuse as late, at a point that can go
 * offline. A document a lookup found authorised (its protocol is kept) is
 * SEFAZ's: sending the same call again fetches its XML (the service settles
 * the duplicate by a lookup), and it must never go offline beside its own
 * authorisation.
 */
function staleOnline(ctx: FiscalContext, document: FiscalDocument, point: IssuingPoint): boolean {
  const knownToSefaz = document.status === "SUBMITTED" && document.protocol !== null;
  return !knownToSefaz && canGoOffline(document, point) && pastOnlineTolerance(ctx, document);
}

/** The failure a send not answered by its online deadline counts as: a contingency, its outcome unknown. */
function pastDeadline(document: FiscalDocument): IssuerFailure {
  return {
    class: "CONTINGENCY",
    code: null,
    message: "SEFAZ did not answer before the online deadline.",
    details: [],
    accessKey: document.accessKey ?? computeAccessKey({ sale: document.sale, model: document.model, seriesKind: "ONLINE" }),
    signedXml: null,
    sefazReply: null,
    outcomeUnknown: true,
  };
}

/** The send, raced against the deadline (`deadlineAt`, epoch ms). A late answer is dropped: the number is looked up instead. */
async function sendBefore(
  send: Promise<IssuerOutcome<IssuedDocument>>,
  document: FiscalDocument,
  deadlineAt: number,
): Promise<IssuerOutcome<IssuedDocument>> {
  send.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<IssuerOutcome<IssuedDocument>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: pastDeadline(document) }), Math.max(0, deadlineAt - Date.now()));
  });
  try {
    return await Promise.race([send, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The online send, bounded by the deadline when there is one. */
function send(ctx: FiscalContext, document: FiscalDocument, signing: SigningMaterial, deadlineAt: number | null): Promise<IssuerOutcome<IssuedDocument>> {
  const call = ctx.config.issuer.issue({ model: document.model, environment: document.environment, signing, document: document.sale });
  return deadlineAt === null ? call : sendBefore(call, document, deadlineAt);
}

/** Whether a failed send moves the sale offline: a contingency always; with a deadline, an unanswered send too. */
function goesOffline(error: IssuerFailure, deadlineAt: number | null): boolean {
  return error.class === "CONTINGENCY" || (deadlineAt !== null && error.class === "RETRYABLE");
}

/**
 * Issue (or re-issue, for a SUBMITTED one) a document on its online series.
 * `deadlineAt` (epoch ms): the online deadline, for an NFC-e whose point can
 * go offline (see the module doc); `null`, the send's own timeout rules.
 */
export async function submit(
  ctx: FiscalContext,
  document: FiscalDocument,
  profile: EmitterProfile,
  point: IssuingPoint,
  signing: SigningMaterial,
  deadlineAt: number | null = null,
): Promise<FiscalDocument> {
  if (staleOnline(ctx, document, point)) return goOffline(ctx, document, profile, point, signing);
  const sent = document.status === "PENDING" ? await ctx.advance(document, { kind: "SUBMIT" }) : document;
  const bounded = deadlineAt !== null && canGoOffline(sent, point) ? deadlineAt : null;
  const outcome = await send(ctx, sent, signing, bounded);
  if (outcome.ok) return accept(ctx, sent, outcome.answer);
  if (FINAL_FAILURES.has(outcome.error.class)) return reject(ctx, sent, outcome.error);
  const retried = await ctx.advance(sent, { kind: "RETRY", error: outcome.error, ...(await keepSigned(ctx, sent, outcome.error)) });
  return goesOffline(outcome.error, bounded) && canGoOffline(retried, point) ? goOffline(ctx, retried, profile, point, signing) : retried;
}

/**
 * A live online NFC-e the caller's deadline already passed — `onlineDeadlineMs`
 * since it was numbered, still unanswered and not known to SEFAZ — goes offline
 * now, at a point with a contingency series; anything else is answered as it is.
 */
async function offlineIfOverdue(
  ctx: FiscalContext,
  document: FiscalDocument,
  profile: EmitterProfile,
  point: IssuingPoint,
  signing: SigningMaterial,
  onlineDeadlineMs: number,
): Promise<FiscalDocument> {
  const waiting = document.status === "PENDING" || document.status === "SUBMITTED";
  const overdue = ctx.config.now().getTime() - Date.parse(document.createdAt) >= onlineDeadlineMs;
  if (!waiting || !overdue || document.protocol !== null || !canGoOffline(document, point)) return document;
  return goOffline(ctx, document, profile, point, signing);
}

/** Transmit a document signed offline. */
export async function transmit(ctx: FiscalContext, document: FiscalDocument, signing: SigningMaterial): Promise<FiscalDocument> {
  const signedXml = document.xmlKey === null ? null : await ctx.config.storage.get(document.xmlKey);
  if (signedXml === null) throw new FiscalDocumentError("NOT_FOUND", `document ${document.id} has no signed XML in storage.`);
  const outcome = await ctx.config.issuer.transmit({ model: document.model, environment: document.environment, signing, signedXml });
  if (outcome.ok) return accept(ctx, document, outcome.answer);
  if (FINAL_FAILURES.has(outcome.error.class)) return reject(ctx, document, outcome.error);
  return ctx.advance(document, { kind: "RETRY", error: outcome.error });
}

/** The live document of a lost race or an earlier call — moved offline when the caller's online deadline already passed. */
export async function answerLive(
  ctx: FiscalContext,
  existing: FiscalDocument,
  profile: EmitterProfile,
  onlineDeadlineMs: number | undefined,
): Promise<FiscalDocument> {
  if (onlineDeadlineMs === undefined || existing.model !== "NFCE" || existing.seriesKind !== "ONLINE") return existing;
  const point = await ctx.requirePoint(existing.ownerId, existing.issuingPointId);
  return offlineIfOverdue(ctx, existing, profile, point, await ctx.material(profile), onlineDeadlineMs);
}

/** `onlineDeadlineMs`, when given, is a whole number of milliseconds, 0 or more. */
export function assertOnlineDeadline(onlineDeadlineMs: number | undefined): void {
  if (onlineDeadlineMs !== undefined && (!Number.isInteger(onlineDeadlineMs) || onlineDeadlineMs < 0)) {
    throw new FiscalDocumentError("INVALID_INPUT", "onlineDeadlineMs must be a whole number of milliseconds, 0 or more.");
  }
}
