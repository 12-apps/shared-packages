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
import type { CancelledDocument } from "../sidecar/types";
import { type FiscalContext, xmlKeys } from "./context";
import type { EmitterProfile } from "./profile";
import type { FiscalDocument, NumberVoid } from "./types";

type Settle = (ctx: FiscalContext, document: FiscalDocument, profile: EmitterProfile, signing: SigningMaterial) => Promise<FiscalDocument>;

/** A refusal the same call would meet again: a person must look. */
const REFUSALS = new Set<IssuerFailure["class"]>(["REJECTED", "AUTH", "INVALID", "INTERNAL"]);

function defer(ctx: FiscalContext, document: FiscalDocument, what: string, error: IssuerFailure): Promise<FiscalDocument> {
  return ctx.advance(document, { kind: "DEFER", reason: `${what} failed`, error, attention: REFUSALS.has(error.class) });
}

const lookupFirst: Settle = async (ctx, document, _profile, signing) => {
  if (document.accessKey === null) return ctx.advance(document, { kind: "DEFER", reason: "no access key to look up", error: null, attention: true });
  const outcome = await ctx.config.issuer.lookup({ model: document.model, environment: document.environment, signing, accessKey: document.accessKey });
  return outcome.ok ? ctx.advance(document, { kind: "LOOKUP", answer: outcome.answer }) : defer(ctx, document, "the lookup", outcome.error);
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
