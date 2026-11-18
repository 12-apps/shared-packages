/**
 * The pure helpers the document service builds a document with: the local
 * clock, the key code, the access key, the issuer block, the totals, the
 * storage keys. No port, no state.
 */

import type { DocumentIssuer, SaleForDocument, Uf } from "../sale/types";
import { FiscalDocumentError } from "./errors";
import type { SaleDraft } from "./ports";
import type { EmitterProfile } from "./profile";
import type { DocumentTotals, FiscalDocument, FiscalDocumentModel, SeriesKind } from "./types";

/** `2026-11-20T12:30:00-03:00`: the instant as the owner's wall clock. */
export function localIso(at: Date, offset: string): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (match === null) throw new FiscalDocumentError("INVALID_INPUT", `utcOffset answered "${offset}", not ±HH:MM.`);
  const minutes = (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  return `${new Date(at.getTime() + minutes * 60_000).toISOString().slice(0, 19)}${offset}`;
}

const UNBIASED_LIMIT = Math.floor(2 ** 32 / 100_000_000) * 100_000_000;

/** `cNF`: eight random digits, never equal to the number's own eight (the layout's rule). */
export function drawKeyCode(number: number): string {
  const own = String(number % 100_000_000).padStart(8, "0");
  for (;;) {
    const [value] = globalThis.crypto.getRandomValues(new Uint32Array(1));
    // Rejection sampling: values at or above the last whole multiple of 10^8 would bias the low codes.
    if (value === undefined || value >= UNBIASED_LIMIT) continue;
    const code = String(value % 100_000_000).padStart(8, "0");
    if (code !== own) return code;
  }
}

const FILLED_BY_THE_PACKAGE = new Set(["series", "number", "keyCode", "issuer", "issuedAt"]);

/** A stored sale back to the draft it was built from (for a second document of the same sale). */
export function draftOf(sale: SaleForDocument): SaleDraft {
  return Object.fromEntries(Object.entries(sale).filter(([key]) => !FILLED_BY_THE_PACKAGE.has(key))) as unknown as SaleDraft;
}

export function issuerOf(profile: EmitterProfile): DocumentIssuer {
  return {
    cnpj: profile.cnpj,
    stateRegistration: profile.stateRegistration,
    legalName: profile.legalName,
    tradeName: profile.tradeName,
    taxRegime: profile.taxRegime,
    address: profile.address,
  };
}

export function totalsOf(sale: SaleDraft): DocumentTotals {
  const sum = (pick: (line: SaleDraft["lines"][number]) => number) => sale.lines.reduce((total, line) => total + pick(line), 0);
  const discountCents = sum((line) => line.discountCents);
  return {
    totalCents: sum((line) => line.valueCents) - discountCents,
    discountCents,
    cbsCents: sum((line) => line.ibsCbs?.figures?.cbsCents ?? 0),
    ibsUfCents: sum((line) => line.ibsCbs?.figures?.ibsUfCents ?? 0),
    ibsMunCents: sum((line) => line.ibsCbs?.figures?.ibsMunCents ?? 0),
  };
}

/** `text` without any trailing run of `char`, in linear time (no regex backtracking). */
export function trimEnd(text: string, char: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === char) end -= 1;
  return text.slice(0, end);
}

/** Storage keys, by access key: one folder per document, whatever its owner. */
export const xmlKeys = {
  signed: (accessKey: string) => `fiscal/${accessKey}/signed.xml`,
  /** One signed XML per digest: every XML a failed call returned under a key is kept, none overwritten. */
  signedByDigest: (accessKey: string, digest: string) =>
    `fiscal/${accessKey}/signed-${trimEnd(digest.replace(/\+/g, "-").replace(/\//g, "_"), "=")}.xml`,
  authorized: (accessKey: string) => `fiscal/${accessKey}/authorized.xml`,
  cancel: (accessKey: string) => `fiscal/${accessKey}/cancel.xml`,
  /** The event 110300 of `nSeqEvento` `sequence`. */
  linkPayment: (accessKey: string, sequence: number) => `fiscal/${accessKey}/link-payment-${sequence}.xml`,
  inutilization: (document: FiscalDocument) =>
    `fiscal/inutilization/${document.environment}/${document.model}/${document.ownerId}/${document.series}-${document.number}.xml`,
};

/** The IBGE code of each federative unit: the access key's first two digits. */
const UF_CODES: Readonly<Record<Uf, string>> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23", RN: "24", PB: "25",
  PE: "26", AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50",
  MT: "51", GO: "52", DF: "53",
};

/** The access key's modulo-11 check digit (weights 2–9 from the right). */
function keyCheckDigit(body: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += (body.charCodeAt(i) - 48) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** cUF and AAMM, the issuer's CNPJ (alphanumeric from July 2026), then model to `cDV`, all digits. */
const ACCESS_KEY_SHAPE = /^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$/;
/** `NFref` occurs at most 500 times. */
const MAX_REFERENCED_DOCUMENTS = 500;

/**
 * Whether `key` is an access key as the layout writes one: 44 characters, the
 * CNPJ inside it alphanumeric or not, and its modulo-11 check digit right.
 */
export function isValidAccessKey(key: string): boolean {
  if (!ACCESS_KEY_SHAPE.test(key)) return false;
  return keyCheckDigit(key.slice(0, 43)) === Number(key.slice(43));
}

/**
 * Refuses a sale the model cannot carry, before a number is drawn: a return on
 * an NFC-e, an NFC-e of entry, an NFC-e quoting another document (SEFAZ
 * rejects `NFref` on a model 65 with 708, and the number would be burned), a
 * return quoting nothing, or a reference that is not an access key. A document without `operation` and
 * `referencedDocuments` passes as it always did.
 */
export function assertDraftFits(draft: Pick<SaleDraft, "purpose" | "operation" | "referencedDocuments">, model: FiscalDocumentModel): void {
  const references = draft.referencedDocuments ?? [];
  if (model === "NFCE") assertNfceDraftFits(draft, references.length);
  if (draft.purpose === "RETURN" && references.length === 0) {
    throw new FiscalDocumentError("RETURN_NEEDS_REFERENCE", "a return must reference the document it returns (referencedDocuments).");
  }
  if (references.length > MAX_REFERENCED_DOCUMENTS) {
    throw new FiscalDocumentError("INVALID_INPUT", `at most ${MAX_REFERENCED_DOCUMENTS} referenced documents, not ${references.length}.`);
  }
  const bad = references.findIndex((reference) => !isValidAccessKey(reference.accessKey));
  if (bad !== -1) {
    throw new FiscalDocumentError("INVALID_INPUT", `referencedDocuments[${bad}].accessKey is not a 44-character access key.`);
  }
}

/** The NFC-e half of `assertDraftFits`: no return, no entry, no reference. */
function assertNfceDraftFits(draft: Pick<SaleDraft, "purpose" | "operation">, referenceCount: number): void {
  if (draft.purpose === "RETURN") {
    throw new FiscalDocumentError("RETURN_ON_NFCE", "an NFC-e has no return purpose: issue an NF-e (model 55) of entry referencing it.");
  }
  if (draft.operation === "IN") {
    throw new FiscalDocumentError("INVALID_INPUT", 'an NFC-e is an outgoing document: operation must be "OUT".');
  }
  if (referenceCount > 0) {
    throw new FiscalDocumentError("INVALID_INPUT", "an NFC-e references no document (SEFAZ 708): referencedDocuments must be empty.");
  }
}

/**
 * The 44-character access key a document will carry, computed as the layout
 * does: cUF, AAMM of `dhEmi`, CNPJ, model, series, number, `tpEmis` (1 online,
 * 9 offline NFC-e), `cNF` and the check digit. The package knows a document's
 * key before any call, so an unanswered send can always be looked up.
 */
export function computeAccessKey(input: {
  readonly sale: Pick<SaleForDocument, "issuer" | "issuedAt" | "series" | "number" | "keyCode">;
  readonly model: FiscalDocumentModel;
  readonly seriesKind: SeriesKind;
}): string {
  const { sale } = input;
  const body = [
    UF_CODES[sale.issuer.address.uf],
    sale.issuedAt.slice(2, 4),
    sale.issuedAt.slice(5, 7),
    sale.issuer.cnpj,
    input.model === "NFE" ? "55" : "65",
    String(sale.series).padStart(3, "0"),
    String(sale.number).padStart(9, "0"),
    input.seriesKind === "CONTINGENCY" ? "9" : "1",
    sale.keyCode,
  ].join("");
  return `${body}${keyCheckDigit(body)}`;
}

