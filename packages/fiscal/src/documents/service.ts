/**
 * `createFiscalDocuments` — the document service: the emitter profile, the
 * issuing points, and issuing, cancelling, looking up and sweeping documents
 * over the host's ports. Every SEFAZ step goes through the Issuer port and
 * every state change through the state machine (`./machine`), persisted with
 * its event.
 *
 * The certificate, its password and the CSC are encrypted through the host's
 * cipher the moment they arrive, decrypted by the signing identity for one
 * call, and never logged, answered or put in an error.
 */

import type { IssuerFailure } from "../issuer/port";
import type { LookedUpDocument } from "../sidecar/types";
import { FiscalContext, assertConfig, assertReason, xmlKeys } from "./context";
import { FiscalDocumentError } from "./errors";
import { canTransition } from "./machine";
import {
  type Deps,
  type FiscalDocumentsServiceConfig,
  createIssuingPoint,
  saveProfile,
  uploadCertificate,
} from "./service-profile";
import { settleNumber, signOffline, submit, transmit } from "./steps";
import type { FiscalDocument, FiscalDocumentModel } from "./types";

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

/** A live document is one the subject still stands on: not rejected, not replaced. */
const DEAD = new Set<FiscalDocument["status"]>(["REJECTED", "REPLACED"]);

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
  const live = (await config.store.listBySubject(input.ownerId, input.subjectId, input.model)).filter((d) => !DEAD.has(d.status));
  return live[live.length - 1] ?? null;
}

async function requireDocument({ config }: Deps, ownerId: string, documentId: string): Promise<FiscalDocument> {
  const document = await config.store.getDocument(ownerId, documentId);
  if (document === null) throw new FiscalDocumentError("NOT_FOUND", `owner ${ownerId} has no document ${documentId}.`);
  return document;
}

async function issue(deps: Deps, input: IssueInput): Promise<FiscalDocument> {
  const { profile, point } = await issuable(deps, input.ownerId, input.issuingPointId, input.model);
  const existing = await liveDocument(deps, input);
  if (existing !== null) return existing;
  const signing = await deps.ctx.material(profile);
  const draft = await deps.config.sales.saleFor({ ownerId: input.ownerId, subjectId: input.subjectId, model: input.model });
  const document = await deps.ctx.createNumbered({ profile, point, subjectId: input.subjectId, model: input.model, seriesKind: "ONLINE", draft });
  return submit(deps.ctx, document, profile, point, signing);
}

async function issueOffline(deps: Deps, input: Omit<IssueInput, "model">): Promise<FiscalDocument> {
  const { profile, point } = await issuable(deps, input.ownerId, input.issuingPointId, "NFCE");
  const existing = await liveDocument(deps, { ...input, model: "NFCE" });
  if (existing !== null) return existing;
  const signing = await deps.ctx.material(profile);
  const draft = await deps.config.sales.saleFor({ ownerId: input.ownerId, subjectId: input.subjectId, model: "NFCE" });
  const document = await deps.ctx.createNumbered({ profile, point, subjectId: input.subjectId, model: "NFCE", seriesKind: "CONTINGENCY", draft });
  const signed = await signOffline(deps.ctx, document, profile, signing);
  if (signed.error === null) return signed.document;
  await deps.ctx.advance(document, { kind: "REPLACE", replacedById: document.id });
  throw new FiscalDocumentError("NOT_ISSUABLE", `the sale could not be signed offline: ${signed.error.class}.`);
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
  const moves = canTransition(document.status, "LOOKUP") && (document.status !== "REPLACED" || document.numberVoid === "LOOKUP_FIRST");
  const after = moves ? await deps.ctx.advance(document, { kind: "LOOKUP", answer: outcome.answer }) : document;
  return { document: after, answer: outcome.answer, failure: null };
}

/** One step of the sweep on one document: whatever it is owed next. */
async function step({ ctx, config }: Deps, document: FiscalDocument): Promise<FiscalDocument> {
  const profile = await ctx.requireProfile(document.ownerId);
  const signing = await ctx.material(profile);
  if (document.numberVoid !== null) return settleNumber(ctx, document, profile, signing);
  if (document.status === "CONTINGENCY") return transmit(ctx, document, signing);
  const point = await ctx.requirePoint(document.ownerId, document.issuingPointId);
  if (document.seriesKind === "ONLINE") return submit(ctx, document, profile, point, signing);
  // A contingency number left PENDING by a crash between numbering and signing:
  // its sale's online document is still being retried, so this number is voided.
  const siblings = await config.store.listBySubject(document.ownerId, document.subjectId, document.model);
  const online = siblings.find((sibling) => sibling.id !== document.id && sibling.seriesKind === "ONLINE");
  return ctx.advance(document, { kind: "REPLACE", replacedById: online?.id ?? document.id });
}

async function run(deps: Deps, documents: readonly FiscalDocument[]): Promise<SweepReport> {
  const report: SweepReport = { advanced: [], failures: [] };
  for (const document of documents) {
    try {
      const after = await step(deps, document);
      report.advanced.push({ documentId: after.id, status: after.status });
    } catch (error) {
      report.failures.push({ documentId: document.id, message: error instanceof Error ? error.message : "unknown failure" });
    }
  }
  return report;
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
    /** Sign the sale offline at once, without trying SEFAZ (the register knows it is offline). */
    issueOffline: issueOffline.bind(null, deps),
    /** Cancel an authorised document. A refusal (late, say) answers the issuer's failure and changes nothing. */
    cancel: cancel.bind(null, deps),
    /** Ask SEFAZ what it knows of the key; a state the answer moves is recorded. */
    lookup: lookup.bind(null, deps),
    getDocument: requireDocument.bind(null, deps),
    listBySubject: (ownerId: string, subjectId: string, model: FiscalDocumentModel) => store.listBySubject(ownerId, subjectId, model),
    async listEvents(ownerId: string, documentId: string) {
      await requireDocument(deps, ownerId, documentId);
      return store.listEvents(documentId);
    },
    /** One pass of the retry sweep: stale PENDING/SUBMITTED documents, and numbers owed a settlement. */
    async sweep(limit: number): Promise<SweepReport> {
      const staleBefore = new Date(config.now().getTime() - config.staleAfterMs).toISOString();
      return run(deps, await store.listDue({ staleBefore, limit }));
    },
    /** One pass of the contingency transmission: every CONTINGENCY document, oldest first. */
    transmitContingency: async (limit: number): Promise<SweepReport> => run(deps, await store.listContingency({ limit })),
  };
}

export type FiscalDocuments = ReturnType<typeof createFiscalDocuments>;
