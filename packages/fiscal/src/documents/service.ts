/**
 * `createFiscalDocuments` — the document service: the emitter profile, the
 * issuing points, and issuing, cancelling, looking up and sweeping documents
 * over the host's ports. Every SEFAZ step goes through the Issuer port and
 * every state change through the state machine (`./machine`), persisted with
 * its event and its next attempt.
 *
 * The certificate, its password and the CSC are encrypted through the host's
 * cipher the moment they arrive, decrypted by the signing identity for one
 * call, and never logged, answered or put in an error.
 */

import type { IssuerFailure } from "../issuer/port";
import { FISCAL_ISSUE } from "../manifest/permissions";
import type { LookedUpDocument } from "../sidecar/types";
import { FISCAL_CONTINGENCY_DEADLINE, FiscalContext, assertConfig, assertReason, issuerOf, xmlKeys } from "./context";
import { FiscalDocumentError } from "./errors";
import { canTransition } from "./machine";
import { type Deps, type FiscalDocumentsServiceConfig, createIssuingPoint, saveProfile, uploadCertificate } from "./service-profile";
import { settleNumber } from "./settle";
import { signPending, submit, transmit } from "./steps";
import { type FiscalDocument, type FiscalDocumentModel, isLive } from "./types";

export type { CertificateFacts, FiscalDocumentsServiceConfig } from "./service-profile";

export interface SweepReport {
  readonly advanced: Array<{ readonly documentId: string; readonly status: FiscalDocument["status"] }>;
  readonly failures: Array<{ readonly documentId: string; readonly message: string }>;
}

export interface IssueInput {
  readonly ownerId: string;
  readonly subjectId: string;
  readonly issuingPointId: string;
  readonly model: FiscalDocumentModel;
}

/** How long an NFC-e may wait in contingency before it must be transmitted (24 h); the warning goes out at 20 h. */
export const CONTINGENCY_WARNING_AFTER_MS = 20 * 3_600_000;

/** A step's failure that no retry will cure: the document waits for a person. */
const NEEDS_A_PERSON = new Set(["NOT_SUPPORTED", "NOT_ISSUABLE", "NOT_FOUND", "INVALID_INPUT", "SERIES_EXHAUSTED"]);

async function issuable({ ctx }: Deps, ownerId: string, issuingPointId: string, model: FiscalDocumentModel) {
  const profile = await ctx.requireProfile(ownerId);
  if (profile.documentPolicy !== "ISSUED_HERE") {
    throw new FiscalDocumentError("NOT_ISSUABLE", `owner ${ownerId}'s documentPolicy is ${profile.documentPolicy}.`);
  }
  const point = await ctx.requirePoint(ownerId, issuingPointId);
  if (point.model !== model) throw new FiscalDocumentError("INVALID_INPUT", `issuing point ${point.id} issues ${point.model}, not ${model}.`);
  return { profile, point };
}

async function liveDocument({ config }: Deps, input: Omit<IssueInput, "issuingPointId">): Promise<FiscalDocument | null> {
  const live = (await config.store.listBySubject(input.ownerId, input.subjectId, input.model)).filter(isLive);
  return live[live.length - 1] ?? null;
}

async function requireDocument({ config }: Deps, ownerId: string, documentId: string): Promise<FiscalDocument> {
  const document = await config.store.getDocument(ownerId, documentId);
  if (document === null) throw new FiscalDocumentError("NOT_FOUND", `owner ${ownerId} has no document ${documentId}.`);
  return document;
}

/** Number a new document — or, when the subject already has a live one (a concurrent call won), answer that one. */
async function numberOrExisting(deps: Deps, input: Omit<IssueInput, "issuingPointId">, create: () => Promise<FiscalDocument>) {
  try {
    return { document: await create(), created: true };
  } catch (error) {
    if (!(error instanceof FiscalDocumentError) || error.code !== "SUBJECT_HAS_DOCUMENT") throw error;
    const existing = await liveDocument(deps, input);
    if (existing === null) throw error;
    return { document: existing, created: false };
  }
}

async function issue(deps: Deps, input: IssueInput): Promise<FiscalDocument> {
  const { profile, point } = await issuable(deps, input.ownerId, input.issuingPointId, input.model);
  const existing = await liveDocument(deps, input);
  if (existing !== null) return existing;
  const signing = await deps.ctx.material(profile);
  const draft = await deps.config.sales.saleFor({ ownerId: input.ownerId, subjectId: input.subjectId, model: input.model });
  const numbered = await numberOrExisting(deps, input, () =>
    deps.ctx.createNumbered({ profile, point, subjectId: input.subjectId, model: input.model, seriesKind: "ONLINE", draft }),
  );
  return numbered.created ? submit(deps.ctx, numbered.document, profile, point, signing) : numbered.document;
}

/** Sign the sale offline at once (the register knows it is offline). A failure leaves it PENDING for the sweep. */
async function issueOffline(deps: Deps, input: Omit<IssueInput, "model">): Promise<FiscalDocument> {
  const target = { ...input, model: "NFCE" as const };
  const { profile, point } = await issuable(deps, input.ownerId, input.issuingPointId, "NFCE");
  const existing = await liveDocument(deps, target);
  if (existing !== null) return existing;
  const signing = await deps.ctx.material(profile);
  const draft = await deps.config.sales.saleFor({ ownerId: input.ownerId, subjectId: input.subjectId, model: "NFCE" });
  const numbered = await numberOrExisting(deps, target, () =>
    deps.ctx.createNumbered({ profile, point, subjectId: input.subjectId, model: "NFCE", seriesKind: "CONTINGENCY", draft }),
  );
  return numbered.created ? signPending(deps.ctx, numbered.document, profile, signing) : numbered.document;
}

/**
 * A contingency NFC-e SEFAZ rejected on transmission: the buyer holds its
 * DANFE, so the number is never voided. The store corrects the sale (the
 * host's `SaleSource` answers the corrected one) and it is signed again
 * under the SAME series, number and key code, then transmitted by the job.
 */
async function resendContingency(deps: Deps, input: { ownerId: string; documentId: string }): Promise<FiscalDocument> {
  const document = await requireDocument(deps, input.ownerId, input.documentId);
  if (document.status !== "REJECTED" || document.seriesKind !== "CONTINGENCY" || document.contingency === null) {
    throw new FiscalDocumentError("TRANSITION_REFUSED", `document ${document.id} is not a rejected contingency NFC-e.`);
  }
  const profile = await deps.ctx.requireProfile(input.ownerId);
  const draft = await deps.config.sales.saleFor({ ownerId: input.ownerId, subjectId: document.subjectId, model: document.model });
  const sale = { ...draft, series: document.series, number: document.number, keyCode: document.keyCode, issuedAt: document.issuedAt, issuer: issuerOf(profile) };
  const outcome = await deps.config.issuer.signContingency({
    environment: document.environment,
    signing: await deps.ctx.material(profile),
    document: sale,
    contingency: document.contingency,
  });
  if (!outcome.ok) throw new FiscalDocumentError("NOT_ISSUABLE", `the corrected sale could not be signed: ${outcome.error.class} ${outcome.error.code ?? ""}`.trim());
  const xmlKey = xmlKeys.signed(outcome.answer.accessKey);
  await deps.config.storage.put(xmlKey, outcome.answer.signedXml, "application/xml");
  return deps.ctx.advance(document, { kind: "RESIGN", answer: outcome.answer, sale, xmlKey });
}

async function cancel(
  deps: Deps,
  input: { ownerId: string; documentId: string; reason: string },
): Promise<{ document: FiscalDocument; failure: IssuerFailure | null }> {
  assertReason(input.reason, "reason");
  const document = await requireDocument(deps, input.ownerId, input.documentId);
  if (document.status !== "AUTHORIZED" || document.accessKey === null || document.protocol === null) {
    throw new FiscalDocumentError("TRANSITION_REFUSED", `document ${document.id} is ${document.status}; only an authorised document is cancelled.`);
  }
  const profile = await deps.ctx.requireProfile(input.ownerId);
  const outcome = await deps.config.issuer.cancel({
    model: document.model,
    environment: document.environment,
    signing: await deps.ctx.material(profile),
    accessKey: document.accessKey,
    protocol: document.protocol,
    reason: input.reason,
  });
  if (!outcome.ok) return { document, failure: outcome.error };
  const eventXmlKey = outcome.answer.eventXml === null ? null : xmlKeys.cancel(document.accessKey);
  if (eventXmlKey !== null) await deps.config.storage.put(eventXmlKey, outcome.answer.eventXml ?? "", "application/xml");
  const cancelled = await deps.ctx.advance(document, { kind: "CANCEL", answer: outcome.answer, reason: input.reason, eventXmlKey });
  return { document: cancelled, failure: null };
}

/** Whether a lookup's answer moves this document (a settled number moves only while it is owed one). */
function lookupMoves(document: FiscalDocument): boolean {
  if (!canTransition(document.status, "LOOKUP")) return false;
  if (document.status === "REPLACED" || document.status === "REJECTED") return document.numberVoid === "LOOKUP_FIRST";
  return true;
}

async function lookup(
  deps: Deps,
  input: { ownerId: string; documentId: string },
): Promise<{ document: FiscalDocument; answer: LookedUpDocument | null; failure: IssuerFailure | null }> {
  const document = await requireDocument(deps, input.ownerId, input.documentId);
  if (document.accessKey === null) throw new FiscalDocumentError("NOT_FOUND", `document ${document.id} has no access key yet.`);
  const profile = await deps.ctx.requireProfile(input.ownerId);
  const outcome = await deps.config.issuer.lookup({
    model: document.model,
    environment: document.environment,
    signing: await deps.ctx.material(profile),
    accessKey: document.accessKey,
  });
  if (!outcome.ok) return { document, answer: null, failure: outcome.error };
  const after = lookupMoves(document) ? await deps.ctx.advance(document, { kind: "LOOKUP", answer: outcome.answer }) : document;
  return { document: after, answer: outcome.answer, failure: null };
}

/** One step of the sweep on one document: whatever it is owed next. */
async function step({ ctx }: Deps, document: FiscalDocument): Promise<FiscalDocument> {
  const profile = await ctx.requireProfile(document.ownerId);
  const signing = await ctx.material(profile);
  if (document.numberVoid !== null) return settleNumber(ctx, document, profile, signing);
  if (document.status === "CONTINGENCY") return transmit(ctx, document, signing);
  if (document.seriesKind === "CONTINGENCY") return signPending(ctx, document, profile, signing);
  const point = await ctx.requirePoint(document.ownerId, document.issuingPointId);
  return submit(ctx, document, profile, point, signing);
}

/** A step that threw is never silent: the document is deferred, or handed to a person when no retry will cure it. */
async function deferThrown(deps: Deps, document: FiscalDocument, error: unknown): Promise<void> {
  if (error instanceof FiscalDocumentError && error.code === "CONFLICT") return;
  const attention = error instanceof FiscalDocumentError && NEEDS_A_PERSON.has(error.code);
  const reason = error instanceof Error ? error.message : "unknown failure";
  const current = (await deps.config.store.getDocument(document.ownerId, document.id)) ?? document;
  await deps.ctx.advance(current, { kind: "DEFER", reason, error: null, attention }).catch(() => undefined);
}

async function run(deps: Deps, documents: readonly FiscalDocument[]): Promise<SweepReport> {
  const report: SweepReport = { advanced: [], failures: [] };
  for (const document of documents) {
    try {
      const after = await step(deps, document);
      report.advanced.push({ documentId: after.id, status: after.status });
    } catch (error) {
      report.failures.push({ documentId: document.id, message: error instanceof Error ? error.message : "unknown failure" });
      await deferThrown(deps, document, error);
    }
  }
  return report;
}

/** Tell the owner of every NFC-e 20 h into contingency (the transmission deadline is 24 h), once each. */
async function warnContingencyDeadlines(deps: Deps, limit: number): Promise<number> {
  const signedBefore = new Date(deps.config.now().getTime() - CONTINGENCY_WARNING_AFTER_MS).toISOString();
  const due = await deps.config.store.listContingencyDeadline({ signedBefore, limit });
  for (const document of due) {
    const warned = await deps.ctx.advance(document, { kind: "WARN" });
    await deps.config.notify.emit({
      type: FISCAL_CONTINGENCY_DEADLINE,
      recipient: { tenantId: document.ownerId, permission: FISCAL_ISSUE },
      payload: { documentId: warned.id, subjectId: warned.subjectId, series: warned.series, number: warned.number, since: warned.contingency?.since ?? "" },
    });
  }
  return due.length;
}

export function createFiscalDocuments(config: FiscalDocumentsServiceConfig) {
  assertConfig(config);
  if (typeof config.cipher?.encrypt !== "function") throw new TypeError("createFiscalDocuments needs cipher.");
  if (typeof config.readCertificate !== "function") throw new TypeError("createFiscalDocuments needs readCertificate.");
  const deps: Deps = { ctx: new FiscalContext(config), config };
  const { store } = config;
  return {
    getProfile: (ownerId: string) => store.getProfile(ownerId),
    saveProfile: saveProfile.bind(null, deps),
    uploadCertificate: uploadCertificate.bind(null, deps),
    listIssuingPoints: (ownerId: string) => store.listIssuingPoints(ownerId),
    createIssuingPoint: createIssuingPoint.bind(null, deps),
    /** Issue the subject's document, or answer the live one it has. A rejection is final; anything SEFAZ may still answer is the sweep's. */
    issue: issue.bind(null, deps),
    issueOffline: issueOffline.bind(null, deps),
    resendContingency: resendContingency.bind(null, deps),
    /** Cancel an authorised document. A refusal (late, say) answers the issuer's failure and changes nothing. */
    cancel: cancel.bind(null, deps),
    /** Ask SEFAZ what it knows of the key; a state the answer moves is recorded. */
    lookup: lookup.bind(null, deps),
    /** A person takes a document back from `attention`; the sweep tries it again. */
    async release(input: { ownerId: string; documentId: string }): Promise<FiscalDocument> {
      return deps.ctx.advance(await requireDocument(deps, input.ownerId, input.documentId), { kind: "RELEASE" });
    },
    getDocument: requireDocument.bind(null, deps),
    listBySubject: (ownerId: string, subjectId: string, model: FiscalDocumentModel) => store.listBySubject(ownerId, subjectId, model),
    async listEvents(ownerId: string, documentId: string) {
      await requireDocument(deps, ownerId, documentId);
      return store.listEvents(documentId);
    },
    /** One pass of the retry sweep: PENDING/SUBMITTED documents and owed numbers whose next attempt has come. */
    sweep: async (limit: number): Promise<SweepReport> => run(deps, await store.listDue({ now: deps.ctx.nowIso(), limit })),
    /** One pass of the contingency transmission, then the 20-hour deadline warnings. */
    async transmitContingency(limit: number): Promise<SweepReport> {
      const report = await run(deps, await store.listContingency({ now: deps.ctx.nowIso(), limit }));
      await warnContingencyDeadlines(deps, limit);
      return report;
    },
  };
}


export type FiscalDocuments = ReturnType<typeof createFiscalDocuments>;
