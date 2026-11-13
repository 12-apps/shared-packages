/**
 * The reference {@link FiscalStore}: in memory, for tests and harnesses —
 * the role `createMemory*Store` plays in the packages that own storage seams.
 * It keeps the same promises as the SQL store (`./sql-store`): a draw and the
 * insert built from it commit together (a `build` that throws leaves the
 * counter untouched), a replaced document is advanced before its replacement
 * is inserted, and a subject has at most one live document per model.
 */

import { FiscalDocumentError } from "./errors";
import type { FiscalStore, NumberRequest } from "./ports";
import type { EmitterProfile, IssuingPoint } from "./profile";
import { type FiscalDocument, type FiscalDocumentEvent, OWED_VOIDS, isLive } from "./types";

const MAX_NUMBER = 999_999_999;

export interface MemoryFiscalStore extends FiscalStore {
  /** Every event, in order, for assertions. */
  readonly events: FiscalDocumentEvent[];
  /** The next number each counter would hand out, keyed `cnpj|environment|model|series`. */
  readonly counters: Map<string, number>;
}

function counterKey(request: Pick<NumberRequest, "issuerCnpj" | "environment" | "model" | "series">): string {
  return `${request.issuerCnpj}|${request.environment}|${request.model}|${request.series}`;
}

interface State {
  readonly counters: Map<string, number>;
  readonly seriesOwner: Map<string, string>;
  readonly documents: Map<string, FiscalDocument>;
  readonly events: FiscalDocumentEvent[];
}

/** Open a series' counter in both environments; a series belongs to one issuing point. */
function openCounter(state: State, point: IssuingPoint, issuerCnpj: string, series: number, first: number): void {
  for (const environment of ["homologacao", "producao"] as const) {
    const key = counterKey({ issuerCnpj, environment, model: point.model, series });
    const owner = state.seriesOwner.get(key);
    if (owner !== undefined && owner !== point.id) {
      throw new FiscalDocumentError("INVALID_INPUT", `series ${series} already belongs to issuing point ${owner}.`);
    }
  }
  for (const environment of ["homologacao", "producao"] as const) {
    const key = counterKey({ issuerCnpj, environment, model: point.model, series });
    state.seriesOwner.set(key, point.id);
    state.counters.set(key, first);
  }
}

function isDue(document: FiscalDocument, now: string): boolean {
  if (document.attention || document.nextAttemptAt === null || document.nextAttemptAt > now) return false;
  return document.status === "PENDING" || document.status === "SUBMITTED" || OWED_VOIDS.includes(document.numberVoid ?? "INUTILIZED");
}

function save(state: State, previous: FiscalDocument, transition: { document: FiscalDocument; event: FiscalDocumentEvent }): boolean {
  const stored = state.documents.get(previous.id);
  if (stored === undefined || stored.updatedAt !== previous.updatedAt || stored.status !== previous.status) return false;
  state.documents.set(transition.document.id, transition.document);
  state.events.push(transition.event);
  return true;
}

function hasLive(state: State, document: FiscalDocument): boolean {
  return [...state.documents.values()].some(
    (other) => other.ownerId === document.ownerId && other.subjectId === document.subjectId && other.model === document.model && isLive(other),
  );
}

export function createMemoryFiscalStore(): MemoryFiscalStore {
  const profiles = new Map<string, EmitterProfile>();
  const points = new Map<string, IssuingPoint>();
  const state: State = { counters: new Map(), seriesOwner: new Map(), documents: new Map(), events: [] };
  const ordered = (key: (d: FiscalDocument) => string) =>
    [...state.documents.values()].sort((a, b) => key(a).localeCompare(key(b)));

  return {
    events: state.events,
    counters: state.counters,
    getProfile: async (ownerId) => profiles.get(ownerId) ?? null,
    saveProfile: async (profile) => void profiles.set(profile.ownerId, profile),
    async getIssuingPoint(ownerId, id) {
      const point = points.get(id);
      return point?.ownerId === ownerId ? point : null;
    },
    listIssuingPoints: async (ownerId) => [...points.values()].filter((point) => point.ownerId === ownerId),
    async createIssuingPoint(point, issuerCnpj, firstNumber) {
      if (points.has(point.id)) throw new FiscalDocumentError("INVALID_INPUT", `issuing point ${point.id} exists.`);
      openCounter(state, point, issuerCnpj, point.onlineSeries, firstNumber.online);
      if (point.contingencySeries !== null) openCounter(state, point, issuerCnpj, point.contingencySeries, firstNumber.contingency);
      points.set(point.id, point);
    },
    async createDocument(request, build, replace) {
      const key = counterKey(request);
      const number = state.counters.get(key);
      if (number === undefined || state.seriesOwner.get(key) !== request.issuingPointId) {
        throw new FiscalDocumentError("NOT_FOUND", `no counter for series ${request.series} on issuing point ${request.issuingPointId}.`);
      }
      if (number > MAX_NUMBER) throw new FiscalDocumentError("SERIES_EXHAUSTED", `series ${request.series} has no number left.`);
      const document = build(number);
      if (state.documents.has(document.id)) throw new FiscalDocumentError("INVALID_INPUT", `document ${document.id} exists.`);
      const snapshot = new Map(state.documents);
      if (replace !== undefined && !save(state, replace.previous, replace.transition)) {
        throw new FiscalDocumentError("CONFLICT", `document ${replace.previous.id} moved before it was replaced.`);
      }
      if (hasLive(state, document)) {
        // The replace and the insert are one transaction: undo the replace.
        state.documents.clear();
        for (const [id, kept] of snapshot) state.documents.set(id, kept);
        if (replace !== undefined) state.events.pop();
        throw new FiscalDocumentError("SUBJECT_HAS_DOCUMENT", `subject ${document.subjectId} already has a live ${document.model}.`);
      }
      state.counters.set(key, number + 1);
      state.documents.set(document.id, document);
      return document;
    },
    async getDocument(ownerId, id) {
      const document = state.documents.get(id);
      return document?.ownerId === ownerId ? document : null;
    },
    listBySubject: async (ownerId, subjectId, model) =>
      ordered((d) => d.createdAt).filter((d) => d.ownerId === ownerId && d.subjectId === subjectId && d.model === model),
    listEvents: async (documentId) => state.events.filter((event) => event.documentId === documentId),
    saveTransition: async (previous, transition) => save(state, previous, transition),
    listDue: async ({ now, limit }) =>
      ordered((d) => d.nextAttemptAt ?? "").filter((document) => isDue(document, now)).slice(0, limit),
    listContingency: async ({ now, limit }) =>
      ordered((d) => d.nextAttemptAt ?? "")
        .filter((d) => d.status === "CONTINGENCY" && !d.attention && d.nextAttemptAt !== null && d.nextAttemptAt <= now)
        .slice(0, limit),
    listContingencyDeadline: async ({ signedBefore, limit }) =>
      ordered((d) => d.createdAt)
        .filter((d) => d.status === "CONTINGENCY" && d.deadlineWarnedAt === null && Date.parse(d.contingency?.since ?? "") < Date.parse(signedBefore))
        .slice(0, limit),
    listExpiringCertificates: async (before) =>
      [...profiles.values()].filter((p) => p.certificateExpiresAt !== null && p.certificateExpiresAt < before),
  };
}
