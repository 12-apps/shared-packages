/**
 * Contingency blocks (FUT-4717): numbers of an issuing point's contingency
 * series handed to a holder in advance, the notes it signed on them recorded
 * as the subjects' `CONTINGENCY` documents (transmitted by the same pass as
 * the server's own), and the known rest of each block voided at SEFAZ.
 *
 * A station-signed note is transmitted from its stored XML exactly as the
 * server's own contingency documents are (`transmit`): nothing rebuilds it
 * from the sale. A rejection keeps its number (the buyer holds its DANFE):
 * `resendContingency` re-signs it under the same number, as for any
 * contingency NFC-e.
 */

import { FiscalDocumentError } from "./errors";
import { assertDraftFits, issuerOf, totalsOf, xmlKeys } from "./helpers";
import { allBlocks, blockStore } from "./contingency-pass";
import { type SignedContingencyNote, parseSignedContingencyNote } from "./contingency-xml";
import type { Deps } from "./service-profile";
import type {
  ContingencyBlock,
  ContingencyBlockFate,
  ContingencyBlockSource,
  ContingencyBlockState,
  ContingencyBlockStore,
  SaleDraft,
} from "./ports";
import type { FiscalDocument, FiscalDocumentEvent } from "./types";

/** The block size when the caller names none (decided on FUT-4717: 50, a new block at 10 left). */
export const DEFAULT_CONTINGENCY_BLOCK_SIZE = 50;
/** The largest block one call reserves. */
export const MAX_CONTINGENCY_BLOCK_SIZE = 10_000;

function assertHolder(holder: unknown): asserts holder is string {
  if (typeof holder !== "string" || holder.trim() === "" || holder.length > 200) {
    throw new FiscalDocumentError("INVALID_INPUT", "holder must be a non-empty id of at most 200 characters.");
  }
}

function refuse(why: string): never {
  throw new FiscalDocumentError("CONTINGENCY_XML_REFUSED", why);
}

export async function reserveBlock(deps: Deps, input: Parameters<ContingencyBlockSource["reserveBlock"]>[0]): Promise<ContingencyBlock> {
  const store = blockStore(deps.config.store);
  assertHolder(input.holder);
  const size = input.size ?? DEFAULT_CONTINGENCY_BLOCK_SIZE;
  if (!Number.isInteger(size) || size < 1 || size > MAX_CONTINGENCY_BLOCK_SIZE) {
    throw new FiscalDocumentError("INVALID_INPUT", `size must be a whole number from 1 to ${MAX_CONTINGENCY_BLOCK_SIZE}.`);
  }
  const profile = await deps.ctx.requireProfile(input.ownerId);
  if (profile.documentPolicy !== "ISSUED_HERE") {
    throw new FiscalDocumentError("NOT_ISSUABLE", `owner ${input.ownerId}'s documentPolicy is ${profile.documentPolicy}.`);
  }
  const point = await deps.ctx.requirePoint(input.ownerId, input.issuingPointId);
  if (point.model !== "NFCE" || point.contingencySeries === null) {
    throw new FiscalDocumentError("INVALID_INPUT", `issuing point ${point.id} has no NFC-e contingency series.`);
  }
  return store.reserveContingencyBlock({
    request: {
      ownerId: input.ownerId,
      issuerCnpj: profile.cnpj,
      issuingPointId: point.id,
      environment: profile.environment,
      model: "NFCE",
      seriesKind: "CONTINGENCY",
      series: point.contingencySeries,
    },
    size,
    id: deps.config.newId(),
    holder: input.holder,
    at: deps.ctx.nowIso(),
  });
}

/** The CONTINGENCY document a holder's signed note becomes, owed a transmission now. */
function signedDocument(
  deps: Deps,
  input: { ownerId: string; subjectId: string; draft: SaleDraft; note: SignedContingencyNote; block: ContingencyBlock; xmlKey: string },
  profile: Parameters<typeof issuerOf>[0],
): FiscalDocument {
  const { note, draft } = input;
  const at = deps.ctx.nowIso();
  const sale = { ...draft, series: note.series, number: note.number, keyCode: note.keyCode, issuedAt: note.issuedAt, issuer: issuerOf(profile) };
  return {
    id: deps.config.newId(),
    ownerId: input.ownerId,
    issuerCnpj: note.issuerCnpj,
    subjectId: input.subjectId,
    issuingPointId: input.block.issuingPointId,
    model: "NFCE",
    environment: note.environment,
    seriesKind: "CONTINGENCY",
    series: note.series,
    number: note.number,
    keyCode: note.keyCode,
    status: "CONTINGENCY",
    sale,
    // What the buyer's DANFE prints is the XML's: a resend may never change it.
    totals: { ...totalsOf(draft), totalCents: note.totalCents, discountCents: note.discountCents },
    buyerTaxId: note.buyerTaxId,
    accessKey: note.accessKey,
    protocol: null,
    statusCode: null,
    statusReason: null,
    lastErrorClass: null,
    outcomeUnknown: false,
    issuedAt: note.issuedAt,
    authorizedAt: null,
    contingency: note.contingency,
    cancelledAt: null,
    cancelReason: null,
    cancelProtocol: null,
    replacedById: null,
    numberVoid: null,
    xmlKey: input.xmlKey,
    eventXmlKey: null,
    attempts: 0,
    failures: 0,
    nextAttemptAt: at,
    attention: false,
    deadlineWarnedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

function signedEvent(document: FiscalDocument, holder: string): FiscalDocumentEvent {
  return {
    documentId: document.id,
    kind: "SIGN_OFFLINE",
    fromStatus: "PENDING",
    toStatus: "CONTINGENCY",
    at: document.createdAt,
    errorClass: null,
    code: null,
    answer: { signedBy: "HOLDER", holder, accessKey: document.accessKey },
  };
}

/** A replayed upload: the document already recorded under the key, for the same subject. */
function replayed(existing: FiscalDocument, subjectId: string): FiscalDocument {
  if (existing.subjectId !== subjectId) refuse(`access key ${existing.accessKey ?? ""} is recorded for another subject.`);
  return existing;
}

async function blockOf(store: ContingencyBlockStore, ownerId: string, note: SignedContingencyNote, holder: string): Promise<ContingencyBlock> {
  const block = await store.findContingencyBlock({ ownerId, issuerCnpj: note.issuerCnpj, environment: note.environment, series: note.series, number: note.number });
  if (block === null || block.ownerId !== ownerId || block.holder !== holder) {
    refuse(`number ${note.number} of series ${note.series} is not inside a block held by ${holder}.`);
  }
  // Voided at SEFAZ already (a late hand-in behind a higher number): it can never be authorised, the sale is issued online.
  if (block.voided.some((range) => note.number >= range.from && note.number <= range.to)) {
    refuse(`number ${note.number} of series ${note.series} was voided at SEFAZ.`);
  }
  return block;
}

/** The XML must print what the booked sale says: its total and its buyer (a resend could never change them). */
function assertMatchesSale(note: SignedContingencyNote, draft: SaleDraft): void {
  const totalCents = totalsOf(draft).totalCents;
  if (note.totalCents !== totalCents) refuse(`the XML's total (vNF ${note.totalCents} cents) is not the sale's (${totalCents} cents).`);
  if (note.buyerTaxId !== (draft.buyer?.document.number ?? null)) refuse("the XML's buyer document is not the sale's.");
}

/** The note, parsed and checked against the owner's profile. */
async function checkedNote(deps: Deps, input: Parameters<ContingencyBlockSource["recordSigned"]>[0]) {
  assertHolder(input.holder);
  if (typeof input.subjectId !== "string" || input.subjectId === "") throw new FiscalDocumentError("INVALID_INPUT", "subjectId is required.");
  const note = parseSignedContingencyNote(input.signedXml);
  const profile = await deps.ctx.requireProfile(input.ownerId);
  if (note.issuerCnpj !== profile.cnpj) refuse("the XML's issuer is not the owner's CNPJ.");
  if (note.environment !== profile.environment) refuse(`the XML was signed for ${note.environment}, the owner issues in ${profile.environment}.`);
  return { note, profile };
}

/** Insert the note; a concurrent upload of the same note is answered, a number under another key refused. */
async function insertNote(store: ContingencyBlockStore, document: FiscalDocument, holder: string, subjectId: string): Promise<FiscalDocument> {
  try {
    return await store.recordSignedDocument(document, signedEvent(document, holder));
  } catch (error) {
    if (!(error instanceof FiscalDocumentError) || error.code !== "CONFLICT") throw error;
    const raced = await store.getDocumentByAccessKey(document.ownerId, document.accessKey ?? "");
    if (raced !== null) return replayed(raced, subjectId);
    return refuse(`number ${document.number} of series ${document.series} is recorded under another key.`);
  }
}

export async function recordSigned(deps: Deps, input: Parameters<ContingencyBlockSource["recordSigned"]>[0]): Promise<FiscalDocument> {
  const store = blockStore(deps.config.store);
  const { note, profile } = await checkedNote(deps, input);
  const existing = await store.getDocumentByAccessKey(input.ownerId, note.accessKey);
  if (existing !== null) return replayed(existing, input.subjectId);
  const block = await blockOf(store, input.ownerId, note, input.holder);
  const draft = input.sale ?? (await deps.config.sales.saleFor({ ownerId: input.ownerId, subjectId: input.subjectId, model: "NFCE" }));
  assertDraftFits(draft, "NFCE");
  assertMatchesSale(note, draft);
  const xmlKey = xmlKeys.signed(note.accessKey);
  await deps.config.storage.put(xmlKey, input.signedXml, "application/xml");
  const document = signedDocument(deps, { ownerId: input.ownerId, subjectId: input.subjectId, draft, note, block, xmlKey }, profile);
  return insertNote(store, document, input.holder, input.subjectId);
}

async function heldBlock(
  deps: Deps,
  store: ContingencyBlockStore,
  input: { ownerId: string; holder: string; series: number; from: number },
): Promise<ContingencyBlockState> {
  const profile = await deps.ctx.requireProfile(input.ownerId);
  const block = await store.findContingencyBlock({
    ownerId: input.ownerId, issuerCnpj: profile.cnpj, environment: profile.environment, series: input.series, number: input.from,
  });
  if (block === null || block.holder !== input.holder || block.from !== input.from) throw new FiscalDocumentError("NOT_FOUND", `${input.holder} holds no block of series ${input.series} from ${input.from}.`);
  return block;
}

export async function closeBlock(deps: Deps, input: Parameters<ContingencyBlockSource["closeBlock"]>[0]): Promise<ContingencyBlock> {
  const store = blockStore(deps.config.store);
  assertHolder(input.holder);
  const block = await heldBlock(deps, store, input);
  const used = input.sequenceUsed;
  if (!Number.isInteger(used) || used < block.from - 1 || used > block.to) {
    throw new FiscalDocumentError("INVALID_INPUT", `sequenceUsed must be from ${block.from - 1} to ${block.to}.`);
  }
  if (block.fate === "CLOSED" && block.usedUpTo === used) return block;
  if (block.fate !== "OPEN") throw new FiscalDocumentError("TRANSITION_REFUSED", `the block from ${block.from} is ${block.fate}.`);
  const at = deps.ctx.nowIso();
  if (!(await store.closeContingencyBlock({ id: block.id, fate: "CLOSED", usedUpTo: used, at }))) {
    throw new FiscalDocumentError("CONFLICT", `the block from ${block.from} moved while it was closed.`);
  }
  return { ...block, fate: "CLOSED", usedUpTo: used, closedAt: at };
}

/** The holder is gone (a new install took its place): its open blocks are ABANDONED. Answers them. */
export async function abandonBlocks(deps: Deps, input: { ownerId: string; holder: string }): Promise<ContingencyBlock[]> {
  const store = blockStore(deps.config.store);
  assertHolder(input.holder);
  const open = await allBlocks(store, { ownerId: input.ownerId, holder: input.holder, fates: ["OPEN"] });
  const at = deps.ctx.nowIso();
  const abandoned: ContingencyBlock[] = [];
  for (const block of open) {
    if (await store.closeContingencyBlock({ id: block.id, fate: "ABANDONED", usedUpTo: null, at })) {
      abandoned.push({ ...block, fate: "ABANDONED", closedAt: at });
    }
  }
  return abandoned;
}

export async function listBlocks(
  deps: Deps,
  input: { ownerId: string; holder?: string; fates?: readonly ContingencyBlockFate[] },
): Promise<ContingencyBlockState[]> {
  return allBlocks(blockStore(deps.config.store), input);
}

export { listKnownGaps, listUnknownRanges, voidKnownGaps } from "./contingency-pass";
export type { GapVoidReport } from "./contingency-pass";
