/**
 * What every step of the document service shares: the ports, the clock, the
 * host's words written into a document, and the two writes everything goes
 * through — numbering a new document, and persisting one transition with the
 * schedule and the person's flag it implies.
 */

import type { Issuer, SigningMaterial } from "../issuer/port";
import { FISCAL_ISSUE } from "../manifest/permissions";
import { FiscalDocumentError } from "./errors";
import { computeAccessKey, drawKeyCode, issuerOf, localIso, totalsOf } from "./helpers";
import { type DocumentInput, type Transition, transition } from "./machine";
import type { DocumentStorage, FiscalStore, SaleDraft, SaleSource } from "./ports";
import type { EmitterProfile, IssuingPoint } from "./profile";
import type { SigningIdentities } from "./signing";
import { type FiscalDocument, type FiscalDocumentModel, OWED_VOIDS, type SeriesKind } from "./types";

export { computeAccessKey, draftOf, drawKeyCode, issuerOf, localIso, totalsOf, xmlKeys } from "./helpers";

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
  /**
   * How long a document owing a step waits before the sweep takes it again,
   * the base of the backoff: each failure in a row doubles it, up to 64×.
   */
  readonly staleAfterMs: number;
  /**
   * How late an online NFC-e may still be sent with its `dhEmi`. SEFAZ refuses
   * a late one (704, "data-hora de emissão atrasada"; five minutes in most
   * states — the host's, per state). Past it, a stale online NFC-e at a point
   * with a contingency series goes offline instead of being sent again.
   */
  readonly nfceOnlineToleranceMs: number;
  /** Ids for new documents. */
  readonly newId: () => string;
}

export const FISCAL_DOCUMENT_REJECTED = "fiscal.document-rejected";
export const FISCAL_CERTIFICATE_EXPIRING = "fiscal.certificate-expiring";
export const FISCAL_DOCUMENT_NEEDS_ATTENTION = "fiscal.document-needs-attention";
export const FISCAL_CONTINGENCY_DEADLINE = "fiscal.contingency-deadline";

const REQUIRED_PORTS = ["store", "issuer", "signing", "storage", "sales", "notify"] as const;
const REQUIRED_FUNCTIONS = ["now", "utcOffset", "newId"] as const;
const REASONS = ["contingency", "inutilization", "substitution"] as const;
const DURATIONS = ["staleAfterMs", "nfceOnlineToleranceMs"] as const;

export function assertConfig(config: FiscalDocumentsConfig): void {
  const missing = [
    ...REQUIRED_PORTS.filter((port) => config?.[port] === undefined || config[port] === null),
    ...REQUIRED_FUNCTIONS.filter((fn) => typeof config?.[fn] !== "function"),
    ...DURATIONS.filter((name) => !Number.isInteger(config?.[name]) || config[name] <= 0),
  ];
  if (missing.length > 0) throw new TypeError(`createFiscalDocuments needs ${missing.join(", ")}.`);
  for (const name of REASONS) assertReason(config.reasons?.[name], `reasons.${name}`);
}

export function assertReason(text: unknown, name: string): asserts text is string {
  if (typeof text !== "string" || text.trim().length < 15 || text.length > 255) {
    throw new FiscalDocumentError("INVALID_INPUT", `${name} must be 15 to 255 characters.`);
  }
}

/** The backoff never grows past 64 × `staleAfterMs`. */
const MAX_BACKOFF_DOUBLINGS = 6;

/** Whether a document still owes the sweep (or the transmission) a call. */
function owesWork(document: FiscalDocument): boolean {
  if (document.status === "PENDING" || document.status === "SUBMITTED" || document.status === "CONTINGENCY") return true;
  return document.numberVoid !== null && OWED_VOIDS.includes(document.numberVoid);
}

export class FiscalContext {
  constructor(readonly config: FiscalDocumentsConfig) {}

  nowIso(): string {
    return this.config.now().toISOString();
  }

  async localNow(ownerId: string): Promise<string> {
    const at = this.config.now();
    return localIso(at, await this.config.utcOffset(ownerId, at));
  }

  /** When a document may be taken again: never, when nothing is owed or a person must look. */
  nextAttemptAt(document: FiscalDocument): string | null {
    if (document.attention || !owesWork(document)) return null;
    const wait = this.config.staleAfterMs * 2 ** Math.min(document.failures, MAX_BACKOFF_DOUBLINGS);
    return new Date(this.config.now().getTime() + wait).toISOString();
  }

  /** The machine's step, scheduled. */
  scheduled(document: FiscalDocument, input: DocumentInput): Transition {
    const step = transition(document, input, this.nowIso());
    return { ...step, document: { ...step.document, nextAttemptAt: this.nextAttemptAt(step.document) } };
  }

  /**
   * Persist one transition; a lost race is a `CONFLICT`, never a silent
   * overwrite. A document that has just come to need a person is announced.
   */
  async advance(document: FiscalDocument, input: DocumentInput): Promise<FiscalDocument> {
    const step = this.scheduled(document, input);
    if (!(await this.config.store.saveTransition(document, step))) {
      throw new FiscalDocumentError("CONFLICT", `document ${document.id} moved while ${input.kind} was applied.`);
    }
    if (step.document.attention && !document.attention) await this.announceAttention(step.document);
    return step.document;
  }

  async announceAttention(document: FiscalDocument): Promise<void> {
    await this.config.notify.emit({
      type: FISCAL_DOCUMENT_NEEDS_ATTENTION,
      recipient: { tenantId: document.ownerId, permission: FISCAL_ISSUE },
      payload: {
        documentId: document.id,
        subjectId: document.subjectId,
        model: document.model,
        status: document.status,
        numberVoid: document.numberVoid,
        series: document.series,
        number: document.number,
        code: document.statusCode,
        reason: document.statusReason ?? "",
        failures: document.failures,
      },
    });
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

  /**
   * Draw the next number of a series and store the PENDING document built on
   * it, together. With `replacing`, that document is REPLACED by this one in
   * the same transaction (going offline), so a crash leaves exactly one live.
   */
  async createNumbered(input: {
    readonly profile: EmitterProfile;
    readonly point: IssuingPoint;
    readonly subjectId: string;
    readonly model: FiscalDocumentModel;
    readonly seriesKind: SeriesKind;
    readonly draft: SaleDraft;
    readonly replacing?: FiscalDocument;
  }): Promise<FiscalDocument> {
    const { profile, point, draft } = input;
    const series = input.seriesKind === "ONLINE" ? point.onlineSeries : point.contingencySeries;
    if (series === null) throw new FiscalDocumentError("INVALID_INPUT", `issuing point ${point.id} has no contingency series.`);
    const issuedAt = await this.localNow(profile.ownerId);
    const at = this.nowIso();
    const id = this.config.newId();
    const replace =
      input.replacing === undefined
        ? undefined
        : { previous: input.replacing, transition: this.scheduled(input.replacing, { kind: "REPLACE", replacedById: id }) };
    const request = {
      ownerId: profile.ownerId,
      issuerCnpj: profile.cnpj,
      issuingPointId: point.id,
      environment: profile.environment,
      model: input.model,
      seriesKind: input.seriesKind,
      series,
    };
    return this.config.store.createDocument(
      request,
      (number) => {
        const keyCode = drawKeyCode(number);
        const sale = { ...draft, series, number, keyCode, issuedAt, issuer: issuerOf(profile) };
        return {
          id,
          ownerId: profile.ownerId,
          issuerCnpj: profile.cnpj,
          subjectId: input.subjectId,
          issuingPointId: point.id,
          model: input.model,
          environment: profile.environment,
          seriesKind: input.seriesKind,
          series,
          number,
          keyCode,
          status: "PENDING",
          sale,
          totals: totalsOf(draft),
          buyerTaxId: draft.buyer?.document.number ?? null,
          accessKey: computeAccessKey({ sale, model: input.model, seriesKind: input.seriesKind }),
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
          failures: 0,
          nextAttemptAt: new Date(Date.parse(at) + this.config.staleAfterMs).toISOString(),
          attention: false,
          deadlineWarnedAt: null,
          createdAt: at,
          updatedAt: at,
        };
      },
      replace,
    );
  }
}
