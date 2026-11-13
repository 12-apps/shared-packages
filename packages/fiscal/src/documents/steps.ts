/**
 * The steps that talk to the issuer, each one call and the transition its
 * answer earns. The mapping of the service's classes:
 *
 * | answer | on a document being issued | on a contingency document being transmitted |
 * |---|---|---|
 * | `AUTHORIZED` / `DENIED` | AUTHORIZE / DENY | AUTHORIZE / DENY |
 * | `REJECTED`, `INVALID`, `INTERNAL` | REJECT (the same call would fail again) | REJECT |
 * | `CONTINGENCY`, NFC-e, point with a contingency series | a second document, signed offline; this one REPLACED | RETRY |
 * | `CONTINGENCY` otherwise, `RETRYABLE`, `AUTH` | RETRY: the sweep calls again | RETRY |
 *
 * `AUTH` is a retry, not a rejection: the certificate is the store's to fix,
 * and the sale's number stays the same once it is.
 */

import type { IssuerFailure, IssuerOutcome, SigningMaterial } from "../issuer/port";
import type { IssuedDocument } from "../sidecar/types";
import { FISCAL_ISSUE } from "../manifest/permissions";
import { FISCAL_DOCUMENT_REJECTED, type FiscalContext, draftOf, xmlKeys } from "./context";
import { FiscalDocumentError } from "./errors";
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

function goesOffline(document: FiscalDocument, point: IssuingPoint, error: IssuerFailure): boolean {
  return error.class === "CONTINGENCY" && document.model === "NFCE" && document.seriesKind === "ONLINE" && point.contingencySeries !== null;
}

/** Sign a contingency-series document offline. On a failure it is left PENDING, for the caller to settle. */
export async function signOffline(
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

/**
 * The online call answered CONTINGENCY: number a second document on the
 * contingency series, sign it offline, and replace the first. If signing
 * fails too, the second document is replaced instead (its number owed an
 * inutilization) and the first stays SUBMITTED for the sweep.
 */
async function goOffline(
  ctx: FiscalContext,
  document: FiscalDocument,
  profile: EmitterProfile,
  point: IssuingPoint,
  signing: SigningMaterial,
): Promise<FiscalDocument> {
  const draft = draftOf(document.sale);
  const offline = await ctx.createNumbered({ profile, point, subjectId: document.subjectId, model: document.model, seriesKind: "CONTINGENCY", draft });
  const signed = await signOffline(ctx, offline, profile, signing);
  if (signed.error !== null) {
    await ctx.advance(offline, { kind: "REPLACE", replacedById: document.id });
    return document;
  }
  await ctx.advance(document, { kind: "REPLACE", replacedById: offline.id });
  return signed.document;
}

/** Issue (or re-issue, for a SUBMITTED one) a document on its online series. */
export async function submit(
  ctx: FiscalContext,
  document: FiscalDocument,
  profile: EmitterProfile,
  point: IssuingPoint,
  signing: SigningMaterial,
): Promise<FiscalDocument> {
  const sent = document.status === "PENDING" ? await ctx.advance(document, { kind: "SUBMIT" }) : document;
  const outcome = await ctx.config.issuer.issue({ model: sent.model, environment: sent.environment, signing, document: sent.sale });
  if (outcome.ok) return accept(ctx, sent, outcome.answer);
  if (FINAL_FAILURES.has(outcome.error.class)) return reject(ctx, sent, outcome.error);
  const retried = await ctx.advance(sent, { kind: "RETRY", error: outcome.error });
  return goesOffline(retried, point, outcome.error) ? goOffline(ctx, retried, profile, point, signing) : retried;
}

/** Transmit a document signed offline. */
export async function transmit(ctx: FiscalContext, document: FiscalDocument, signing: SigningMaterial): Promise<FiscalDocument> {
  const signedXml = document.xmlKey === null ? null : await ctx.config.storage.get(document.xmlKey);
  if (signedXml === null) throw new FiscalDocumentError("NOT_FOUND", `document ${document.id} has no signed XML in storage.`);
  const outcome: IssuerOutcome<IssuedDocument> = await ctx.config.issuer.transmit({
    model: document.model,
    environment: document.environment,
    signing,
    signedXml,
  });
  if (outcome.ok) return accept(ctx, document, outcome.answer);
  if (FINAL_FAILURES.has(outcome.error.class)) return reject(ctx, document, outcome.error);
  return ctx.advance(document, { kind: "RETRY", error: outcome.error });
}

type Settle = (ctx: FiscalContext, document: FiscalDocument, profile: EmitterProfile, signing: SigningMaterial) => Promise<FiscalDocument>;

/** A request went out unanswered before the sale moved offline: ask SEFAZ first. */
const lookupFirst: Settle = async (ctx, document, _profile, signing) => {
  if (document.accessKey === null) return document;
  const outcome = await ctx.config.issuer.lookup({ model: document.model, environment: document.environment, signing, accessKey: document.accessKey });
  return outcome.ok ? ctx.advance(document, { kind: "LOOKUP", answer: outcome.answer }) : document;
};

/** Found authorised after its sale moved offline: cancel it, with the host's substitution reason. */
const cancelOwed: Settle = async (ctx, document, _profile, signing) => {
  const { accessKey, protocol } = document;
  if (accessKey === null || protocol === null) return document;
  const reason = ctx.config.reasons.substitution;
  const outcome = await ctx.config.issuer.cancel({ model: document.model, environment: document.environment, signing, accessKey, protocol, reason });
  if (!outcome.ok) return document;
  const eventXmlKey = outcome.answer.eventXml === null ? null : xmlKeys.cancel(accessKey);
  if (eventXmlKey !== null) await ctx.config.storage.put(eventXmlKey, outcome.answer.eventXml ?? "", "application/xml");
  return ctx.advance(document, { kind: "CANCEL", answer: outcome.answer, reason, eventXmlKey });
};

/** Never used at SEFAZ: inutilize the one number. */
const inutilizeOwed: Settle = async (ctx, document, profile, signing) => {
  const outcome = await ctx.config.issuer.inutilize({
    model: document.model,
    environment: document.environment,
    signing,
    uf: profile.address.uf,
    cnpj: profile.cnpj,
    year: Number(document.issuedAt.slice(0, 4)),
    series: document.series,
    from: document.number,
    to: document.number,
    reason: ctx.config.reasons.inutilization,
  });
  if (!outcome.ok) return document;
  const xml = outcome.answer.inutilizationXml;
  const eventXmlKey = xml === null ? null : xmlKeys.inutilization(document);
  if (eventXmlKey !== null) await ctx.config.storage.put(eventXmlKey, xml ?? "", "application/xml");
  return ctx.advance(document, { kind: "INUTILIZE", answer: outcome.answer, eventXmlKey });
};

const SETTLE: Partial<Record<NonNullable<FiscalDocument["numberVoid"]>, Settle>> = {
  LOOKUP_FIRST: lookupFirst,
  CANCEL: cancelOwed,
  INUTILIZE: inutilizeOwed,
};

/**
 * Settle what a replaced or rejected document still owes on its number. A
 * failed call leaves it as it was, for the next sweep.
 */
export async function settleNumber(ctx: FiscalContext, document: FiscalDocument, profile: EmitterProfile, signing: SigningMaterial): Promise<FiscalDocument> {
  const settle = document.numberVoid === null ? undefined : SETTLE[document.numberVoid];
  return settle === undefined ? document : settle(ctx, document, profile, signing);
}
