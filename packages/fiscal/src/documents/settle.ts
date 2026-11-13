/**
 * Settling a number SEFAZ never used, so a series has no unexplained gap:
 * look it up first when a send went unanswered, cancel it if SEFAZ authorised
 * it after all (by SUBSTITUTION, event 110112, when a contingency document
 * replaced it), inutilize it otherwise.
 *
 * A call that fails is never silent: it is DEFERRED — one more failure, a
 * later attempt — and a refusal SEFAZ will repeat (241 number used, 256, 501
 * late cancel, a certificate refused) hands the document to a person at once,
 * with the needs-attention notification.
 */

import type { IssuerFailure, IssuerOutcome, SigningMaterial } from "../issuer/port";
import type { CancelledDocument, LookedUpDocument } from "../sidecar/types";
import { type FiscalContext, xmlKeys } from "./context";
import { assembleNfeProc, protocolDigestOf } from "./nfe-proc";
import type { EmitterProfile } from "./profile";
import type { FiscalDocument, NumberVoid } from "./types";

type Settle = (ctx: FiscalContext, document: FiscalDocument, profile: EmitterProfile, signing: SigningMaterial) => Promise<FiscalDocument>;

/** A refusal the same call would meet again: a person must look. */
const REFUSALS = new Set<IssuerFailure["class"]>(["REJECTED", "AUTH", "INVALID", "INTERNAL"]);

function defer(ctx: FiscalContext, document: FiscalDocument, what: string, error: IssuerFailure): Promise<FiscalDocument> {
  return ctx.advance(document, { kind: "DEFER", reason: `${what} failed`, error, attention: REFUSALS.has(error.class) });
}

/**
 * A SUBMITTED document a lookup finds authorised or denied: its `nfeProc`,
 * from the signed XML whose digest the protocol's `digVal` names and the
 * protocol itself, stored. `undefined` when either is missing — the document
 * then stays SUBMITTED, owing work, and the sweep sends the same call again
 * for the XML.
 */
export async function storeNfeProc(ctx: FiscalContext, document: FiscalDocument, answer: LookedUpDocument): Promise<string | undefined> {
  if ((answer.status !== "AUTHORIZED" && answer.status !== "DENIED") || document.accessKey === null) return undefined;
  // The XML the protocol certifies, by its digest; never simply the last one stored.
  const digest = protocolDigestOf(answer.sefazReply);
  if (digest === null) return undefined;
  const signedXml = await ctx.config.storage.get(xmlKeys.signedByDigest(document.accessKey, digest));
  if (signedXml === null) return undefined;
  const nfeProc = assembleNfeProc({ signedXml, sefazReply: answer.sefazReply, accessKey: document.accessKey });
  if (nfeProc === null) return undefined;
  const xmlKey = xmlKeys.authorized(document.accessKey);
  await ctx.config.storage.put(xmlKey, nfeProc, "application/xml");
  return xmlKey;
}

/**
 * A document a lookup just returned to SUBMITTED (a live REJECTED number
 * found SEFAZ's): settled as AUTHORIZED or DENIED with the same answer when
 * the XML the protocol certifies is held. Two steps, never REJECTED →
 * AUTHORIZED in one.
 */
export async function settleWithXml(ctx: FiscalContext, document: FiscalDocument, answer: LookedUpDocument): Promise<FiscalDocument> {
  if (document.status !== "SUBMITTED") return document;
  const xmlKey = await storeNfeProc(ctx, document, answer);
  return xmlKey === undefined ? document : ctx.advance(document, { kind: "LOOKUP", answer, xmlKey });
}

const lookupFirst: Settle = async (ctx, document, _profile, signing) => {
  if (document.accessKey === null) return ctx.advance(document, { kind: "DEFER", reason: "no access key to look up", error: null, attention: true });
  const outcome = await ctx.config.issuer.lookup({ model: document.model, environment: document.environment, signing, accessKey: document.accessKey });
  if (!outcome.ok) return defer(ctx, document, "the lookup", outcome.error);
  return settleWithXml(ctx, await ctx.advance(document, { kind: "LOOKUP", answer: outcome.answer }), outcome.answer);
};

/** The cancel owed: by substitution when a contingency document replaced it, an ordinary one otherwise. */
async function sendOwedCancel(ctx: FiscalContext, document: FiscalDocument, signing: SigningMaterial): Promise<IssuerOutcome<CancelledDocument> | null> {
  const { accessKey, protocol, replacedById } = document;
  if (accessKey === null || protocol === null) return null;
  const reason = ctx.config.reasons.substitution;
  const base = { environment: document.environment, signing, accessKey, protocol, reason };
  const substitute = replacedById === null ? null : await ctx.config.store.getDocument(document.ownerId, replacedById);
  if (document.model === "NFCE" && substitute?.accessKey) {
    return ctx.config.issuer.cancelBySubstitution({ ...base, substituteAccessKey: substitute.accessKey });
  }
  return ctx.config.issuer.cancel({ ...base, model: document.model });
}

const cancelOwed: Settle = async (ctx, document, _profile, signing) => {
  const outcome = await sendOwedCancel(ctx, document, signing);
  if (outcome === null) return ctx.advance(document, { kind: "DEFER", reason: "no protocol to cancel with", error: null, attention: true });
  if (!outcome.ok) return defer(ctx, document, "the owed cancel", outcome.error);
  const eventXmlKey = outcome.answer.eventXml === null ? null : xmlKeys.cancel(outcome.answer.accessKey);
  if (eventXmlKey !== null) await ctx.config.storage.put(eventXmlKey, outcome.answer.eventXml ?? "", "application/xml");
  return ctx.advance(document, { kind: "CANCEL", answer: outcome.answer, reason: ctx.config.reasons.substitution, eventXmlKey });
};

const inutilizeOwed: Settle = async (ctx, document, profile, signing) => {
  const outcome = await ctx.config.issuer.inutilize({
    model: document.model,
    environment: document.environment,
    signing,
    uf: profile.address.uf,
    cnpj: document.issuerCnpj,
    year: Number(document.issuedAt.slice(0, 4)),
    series: document.series,
    from: document.number,
    to: document.number,
    reason: ctx.config.reasons.inutilization,
  });
  if (!outcome.ok) return defer(ctx, document, "the inutilization", outcome.error);
  const xml = outcome.answer.inutilizationXml;
  const eventXmlKey = xml === null ? null : xmlKeys.inutilization(document);
  if (eventXmlKey !== null) await ctx.config.storage.put(eventXmlKey, xml ?? "", "application/xml");
  return ctx.advance(document, { kind: "INUTILIZE", answer: outcome.answer, eventXmlKey });
};

const SETTLE: Partial<Record<NumberVoid, Settle>> = {
  LOOKUP_FIRST: lookupFirst,
  CANCEL: cancelOwed,
  INUTILIZE: inutilizeOwed,
};

/** Settle what a replaced or rejected document still owes on its number. */
export async function settleNumber(ctx: FiscalContext, document: FiscalDocument, profile: EmitterProfile, signing: SigningMaterial): Promise<FiscalDocument> {
  const settle = document.numberVoid === null ? undefined : SETTLE[document.numberVoid];
  return settle === undefined ? document : settle(ctx, document, profile, signing);
}
