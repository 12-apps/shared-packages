/**
 * What every step of the document service shares: the ports, the clock, the
 * host's words written into a document, and the helpers that number a new
 * document and persist one transition.
 */

import type { Issuer, SigningMaterial } from "../issuer/port";
import type { DocumentIssuer, SaleForDocument } from "../sale/types";
import { FiscalDocumentError } from "./errors";
import { type DocumentInput, transition } from "./machine";
import type { DocumentStorage, FiscalStore, SaleDraft, SaleSource } from "./ports";
import type { EmitterProfile, IssuingPoint } from "./profile";
import type { SigningIdentities } from "./signing";
import type { DocumentTotals, FiscalDocument, FiscalDocumentModel, SeriesKind } from "./types";

/** Twin of `@12-apps/wiring/ports`' `NotifyPort`: never throws. */
export interface FiscalNotifyPort {
  emit(event: {
    readonly type: string;
    readonly recipient: { readonly tenantId: string; readonly permission: string };
    readonly payload: unknown;
  }): Promise<unknown>;
}

/**
 * The words SEFAZ receives in a document, an event or a request — the host's,
 * in the host's language, 15 to 255 characters each. No default: a library
 * that wrote them would be writing a fiscal statement for its host.
 */
export interface FiscalReasons {
  /** `xJust` of a document signed offline. */
  readonly contingency: string;
  /** Why an unused number is inutilized. */
  readonly inutilization: string;
  /** Why a document found authorised after its sale moved to contingency is cancelled. */
  readonly substitution: string;
}

export interface FiscalDocumentsConfig {
  readonly store: FiscalStore;
  readonly issuer: Issuer;
  readonly signing: SigningIdentities;
  readonly storage: DocumentStorage;
  readonly sales: SaleSource;
  readonly notify: FiscalNotifyPort;
  readonly now: () => Date;
  /** The owner's UTC offset at an instant (`-03:00`): `dhEmi` and `dhCont` are local times. */
  readonly utcOffset: (ownerId: string, at: Date) => string | Promise<string>;
  readonly reasons: FiscalReasons;
  /** How long a PENDING or SUBMITTED document waits before the sweep takes it again. */
  readonly staleAfterMs: number;
  /** Ids for new documents. */
  readonly newId: () => string;
}

export const FISCAL_DOCUMENT_REJECTED = "fiscal.document-rejected";
export const FISCAL_CERTIFICATE_EXPIRING = "fiscal.certificate-expiring";

const REQUIRED_PORTS = ["store", "issuer", "signing", "storage", "sales", "notify"] as const;
const REQUIRED_FUNCTIONS = ["now", "utcOffset", "newId"] as const;
const REASONS = ["contingency", "inutilization", "substitution"] as const;

export function assertConfig(config: FiscalDocumentsConfig): void {
  const missing = [
    ...REQUIRED_PORTS.filter((port) => config?.[port] === undefined || config[port] === null),
    ...REQUIRED_FUNCTIONS.filter((fn) => typeof config?.[fn] !== "function"),
  ];
  if (missing.length > 0) throw new TypeError(`createFiscalDocuments needs ${missing.join(", ")}.`);
  for (const name of REASONS) assertReason(config.reasons?.[name], `reasons.${name}`);
  if (!Number.isInteger(config.staleAfterMs) || config.staleAfterMs <= 0) throw new TypeError("createFiscalDocuments needs a positive staleAfterMs.");
}

export function assertReason(text: unknown, name: string): asserts text is string {
  if (typeof text !== "string" || text.trim().length < 15 || text.length > 255) {
    throw new FiscalDocumentError("INVALID_INPUT", `${name} must be 15 to 255 characters.`);
  }
}

/** `2026-11-20T12:30:00-03:00`: the instant as the owner's wall clock. */
export function localIso(at: Date, offset: string): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (match === null) throw new FiscalDocumentError("INVALID_INPUT", `utcOffset answered "${offset}", not ±HH:MM.`);
  const minutes = (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
  return `${new Date(at.getTime() + minutes * 60_000).toISOString().slice(0, 19)}${offset}`;
}

/** `cNF`: eight random digits, never equal to the number's own eight (the layout's rule). */
export function drawKeyCode(number: number): string {
  const own = String(number % 100_000_000).padStart(8, "0");
  for (;;) {
    const [value] = globalThis.crypto.getRandomValues(new Uint32Array(1));
    const code = String((value ?? 0) % 100_000_000).padStart(8, "0");
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

/** Storage keys, by access key: one folder per document, whatever its owner. */
export const xmlKeys = {
  signed: (accessKey: string) => `fiscal/${accessKey}/signed.xml`,
  authorized: (accessKey: string) => `fiscal/${accessKey}/authorized.xml`,
  cancel: (accessKey: string) => `fiscal/${accessKey}/cancel.xml`,
  inutilization: (document: FiscalDocument) =>
    `fiscal/inutilization/${document.environment}/${document.model}/${document.ownerId}/${document.series}-${document.number}.xml`,
};

export class FiscalContext {
  constructor(readonly config: FiscalDocumentsConfig) {}

  nowIso(): string {
    return this.config.now().toISOString();
  }

  async localNow(ownerId: string): Promise<string> {
    const at = this.config.now();
    return localIso(at, await this.config.utcOffset(ownerId, at));
  }

  /** Persist one transition; a lost race is a `CONFLICT`, never a silent overwrite. */
  async advance(document: FiscalDocument, input: DocumentInput): Promise<FiscalDocument> {
    const step = transition(document, input, this.nowIso());
    if (!(await this.config.store.saveTransition(document, step))) {
      throw new FiscalDocumentError("CONFLICT", `document ${document.id} moved while ${input.kind} was applied.`);
    }
    return step.document;
  }

  material(profile: EmitterProfile): Promise<SigningMaterial> {
    return this.config.signing[profile.signingIdentity].materialFor(profile);
  }

  async requireProfile(ownerId: string): Promise<EmitterProfile> {
    const profile = await this.config.store.getProfile(ownerId);
    if (profile === null) throw new FiscalDocumentError("NOT_FOUND", `owner ${ownerId} has no emitter profile.`);
    return profile;
  }

  async requirePoint(ownerId: string, issuingPointId: string): Promise<IssuingPoint> {
    const point = await this.config.store.getIssuingPoint(ownerId, issuingPointId);
    if (point === null) throw new FiscalDocumentError("NOT_FOUND", `owner ${ownerId} has no issuing point ${issuingPointId}.`);
    return point;
  }

  /** Draw the next number of a series and store the PENDING document built on it, together. */
  async createNumbered(input: {
    readonly profile: EmitterProfile;
    readonly point: IssuingPoint;
    readonly subjectId: string;
    readonly model: FiscalDocumentModel;
    readonly seriesKind: SeriesKind;
    readonly draft: SaleDraft;
  }): Promise<FiscalDocument> {
    const { profile, point, draft } = input;
    const series = input.seriesKind === "ONLINE" ? point.onlineSeries : point.contingencySeries;
    if (series === null) throw new FiscalDocumentError("INVALID_INPUT", `issuing point ${point.id} has no contingency series.`);
    const issuedAt = await this.localNow(profile.ownerId);
    const at = this.nowIso();
    const id = this.config.newId();
    return this.config.store.createDocument(
      { ownerId: profile.ownerId, issuingPointId: point.id, environment: profile.environment, model: input.model, seriesKind: input.seriesKind, series },
      (number) => {
        const keyCode = drawKeyCode(number);
        return {
          id,
          ownerId: profile.ownerId,
          subjectId: input.subjectId,
          issuingPointId: point.id,
          model: input.model,
          environment: profile.environment,
          seriesKind: input.seriesKind,
          series,
          number,
          keyCode,
          status: "PENDING",
          sale: { ...draft, series, number, keyCode, issuedAt, issuer: issuerOf(profile) },
          totals: totalsOf(draft),
          buyerTaxId: draft.buyer?.document.number ?? null,
          accessKey: null,
          protocol: null,
          statusCode: null,
          statusReason: null,
          lastErrorClass: null,
          outcomeUnknown: false,
          issuedAt,
          authorizedAt: null,
          contingency: null,
          cancelledAt: null,
          cancelReason: null,
          cancelProtocol: null,
          replacedById: null,
          numberVoid: null,
          xmlKey: null,
          eventXmlKey: null,
          attempts: 0,
          createdAt: at,
          updatedAt: at,
        };
      },
    );
  }
}
