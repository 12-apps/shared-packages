/**
 * The reference {@link FiscalStore}: in memory, for tests and harnesses —
 * the role `createMemory*Store` plays in the packages that own storage seams.
 * Its counters behave as the SQL ones do: a draw and the insert built from it
 * commit together, and a `build` that throws leaves the counter untouched.
 */

import { FiscalDocumentError } from "./errors";
import type { FiscalStore, NumberRequest } from "./ports";
import type { EmitterProfile, IssuingPoint } from "./profile";
import type { FiscalDocument, FiscalDocumentEvent } from "./types";

const MAX_NUMBER = 999_999_999;

export interface MemoryFiscalStore extends FiscalStore {
  /** Every event, in order, for assertions. */
  readonly events: FiscalDocumentEvent[];
  /** The next number each counter would hand out, keyed `owner|environment|model|series`. */
  readonly counters: Map<string, number>;
}

function counterKey(request: Omit<NumberRequest, "issuingPointId" | "seriesKind">): string {
  return `${request.ownerId}|${request.environment}|${request.model}|${request.series}`;
}

const SWEEP_VOIDS = new Set(["LOOKUP_FIRST", "INUTILIZE", "CANCEL"]);

function isDue(document: FiscalDocument, staleBefore: string): boolean {
  if (document.updatedAt >= staleBefore) return false;
  return document.status === "PENDING" || document.status === "SUBMITTED" || SWEEP_VOIDS.has(document.numberVoid ?? "");
}

/** Open a series' counter in both environments; a series belongs to one issuing point. */
function openCounter(state: { counters: Map<string, number>; seriesOwner: Map<string, string> }, point: IssuingPoint, series: number, first: number): void {
  for (const environment of ["homologacao", "producao"] as const) {
    const key = counterKey({ ownerId: point.ownerId, environment, model: point.model, series });
    const owner = state.seriesOwner.get(key);
    if (owner !== undefined && owner !== point.id) {
      throw new FiscalDocumentError("INVALID_INPUT", `series ${series} already belongs to issuing point ${owner}.`);
    }
    state.seriesOwner.set(key, point.id);
    state.counters.set(key, first);
  }
}

export function createMemoryFiscalStore(): MemoryFiscalStore {
  const profiles = new Map<string, EmitterProfile>();
  const points = new Map<string, IssuingPoint>();
  const documents = new Map<string, FiscalDocument>();
  const events: FiscalDocumentEvent[] = [];
  const counters = new Map<string, number>();
  const seriesOwner = new Map<string, string>();
  const state = { counters, seriesOwner };

  const ordered = () => [...documents.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return {
    events,
    counters,
    async getProfile(ownerId) {
      return profiles.get(ownerId) ?? null;
    },
    async saveProfile(profile) {
      profiles.set(profile.ownerId, profile);
    },
    async getIssuingPoint(ownerId, id) {
      const point = points.get(id);
      return point?.ownerId === ownerId ? point : null;
    },
    async listIssuingPoints(ownerId) {
      return [...points.values()].filter((point) => point.ownerId === ownerId);
    },
    async createIssuingPoint(point, firstNumber) {
      if (points.has(point.id)) throw new FiscalDocumentError("INVALID_INPUT", `issuing point ${point.id} exists.`);
      openCounter(state, point, point.onlineSeries, firstNumber.online);
      if (point.contingencySeries !== null) openCounter(state, point, point.contingencySeries, firstNumber.contingency);
      points.set(point.id, point);
    },
    async createDocument(request, build) {
      const key = counterKey(request);
      const number = counters.get(key);
      if (number === undefined || seriesOwner.get(key) !== request.issuingPointId) {
        throw new FiscalDocumentError("NOT_FOUND", `no counter for series ${request.series} on issuing point ${request.issuingPointId}.`);
      }
      if (number > MAX_NUMBER) throw new FiscalDocumentError("SERIES_EXHAUSTED", `series ${request.series} has no number left.`);
      const document = build(number);
      if (documents.has(document.id)) throw new FiscalDocumentError("INVALID_INPUT", `document ${document.id} exists.`);
      counters.set(key, number + 1);
      documents.set(document.id, document);
      return document;
    },
    async getDocument(ownerId, id) {
      const document = documents.get(id);
      return document?.ownerId === ownerId ? document : null;
    },
    async listBySubject(ownerId, subjectId, model) {
      return ordered().filter((d) => d.ownerId === ownerId && d.subjectId === subjectId && d.model === model);
    },
    async listEvents(documentId) {
      return events.filter((event) => event.documentId === documentId);
    },
    async saveTransition(previous, { document, event }) {
      const stored = documents.get(previous.id);
      if (stored === undefined || stored.updatedAt !== previous.updatedAt || stored.status !== previous.status) return false;
      documents.set(document.id, document);
      events.push(event);
      return true;
    },
    async listDue({ staleBefore, limit }) {
      return ordered().filter((document) => isDue(document, staleBefore)).slice(0, limit);
    },
    async listContingency({ limit }) {
      return ordered().filter((document) => document.status === "CONTINGENCY").slice(0, limit);
    },
    async listExpiringCertificates(before) {
      return [...profiles.values()].filter((p) => p.certificateExpiresAt !== null && p.certificateExpiresAt < before);
    },
  };
}
