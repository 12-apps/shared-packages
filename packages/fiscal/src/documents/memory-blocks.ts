/**
 * The memory store's contingency blocks (FUT-4717): the same promises as the
 * SQL store's — a block advances the series' counter and is recorded
 * together, a signed note and its event are inserted together, a key or a
 * number recorded twice is a `CONFLICT`, and a subject keeps one live
 * document.
 */

import { FiscalDocumentError } from "./errors";
import type { ContingencyBlock, ContingencyBlockState, ContingencyBlockStore, NumberRange, NumberRequest } from "./ports";
import { type FiscalDocument, type FiscalDocumentEvent, isLive } from "./types";

const MAX_NUMBER = 999_999_999;

export interface MemoryBlockState {
  readonly counters: Map<string, number>;
  readonly seriesOwner: Map<string, string>;
  readonly documents: Map<string, FiscalDocument>;
  readonly events: FiscalDocumentEvent[];
  readonly counterKey: (request: Pick<NumberRequest, "issuerCnpj" | "environment" | "model" | "series">) => string;
}

interface Void extends NumberRange {
  readonly blockId: string;
}

function sameSeries(a: Pick<FiscalDocument, "issuerCnpj" | "environment" | "model" | "series">, b: typeof a): boolean {
  return a.issuerCnpj === b.issuerCnpj && a.environment === b.environment && a.model === b.model && a.series === b.series;
}

function stateOf(block: ContingencyBlock, documents: Iterable<FiscalDocument>, voids: readonly Void[]): ContingencyBlockState {
  const documented = [...documents]
    .filter((d) => sameSeries(d, block) && d.number >= block.from && d.number <= block.to)
    .map((d) => d.number)
    .sort((a, b) => a - b);
  const voided = voids.filter((v) => v.blockId === block.id).map(({ from, to }) => ({ from, to }));
  return { ...block, documented, voided };
}

function insertSigned(state: MemoryBlockState, document: FiscalDocument, event: FiscalDocumentEvent): FiscalDocument {
  const all = [...state.documents.values()];
  if (all.some((other) => other.accessKey === document.accessKey || (sameSeries(other, document) && other.number === document.number))) {
    throw new FiscalDocumentError("CONFLICT", `key ${document.accessKey ?? ""} or number ${document.number} is recorded already.`);
  }
  const live = all.some((o) => o.ownerId === document.ownerId && o.subjectId === document.subjectId && o.model === document.model && isLive(o));
  if (live) throw new FiscalDocumentError("SUBJECT_HAS_DOCUMENT", `subject ${document.subjectId} already has a live ${document.model}.`);
  state.documents.set(document.id, document);
  state.events.push(event);
  return document;
}

export function memoryBlockMethods(state: MemoryBlockState): ContingencyBlockStore & { readonly blocks: Map<string, ContingencyBlock> } {
  const blocks = new Map<string, ContingencyBlock>();
  const voids: Void[] = [];
  const update = (id: string, patch: Partial<ContingencyBlock>) => {
    const block = blocks.get(id);
    if (block !== undefined) blocks.set(id, { ...block, ...patch });
  };
  return {
    blocks,
    async reserveContingencyBlock({ request, size, id, holder, at }) {
      const key = state.counterKey(request);
      const first = state.counters.get(key);
      if (first === undefined || state.seriesOwner.get(key) !== request.issuingPointId) {
        throw new FiscalDocumentError("NOT_FOUND", `no counter for series ${request.series} on issuing point ${request.issuingPointId}.`);
      }
      if (first + size - 1 > MAX_NUMBER) throw new FiscalDocumentError("SERIES_EXHAUSTED", `series ${request.series} has no ${size} numbers left.`);
      state.counters.set(key, first + size);
      const block: ContingencyBlock = {
        id, ownerId: request.ownerId, issuingPointId: request.issuingPointId, issuerCnpj: request.issuerCnpj,
        environment: request.environment, model: "NFCE", series: request.series, from: first, to: first + size - 1, holder,
        fate: "OPEN", usedUpTo: null, reservedAt: at, closedAt: null, settledAt: null,
      };
      blocks.set(id, block);
      return block;
    },
    async findContingencyBlock(input) {
      const found = [...blocks.values()].find(
        (b) => sameSeries(b, { ...input, model: "NFCE" }) && input.number >= b.from && input.number <= b.to,
      );
      return found === undefined || found.ownerId !== input.ownerId ? null : found;
    },
    async listContingencyBlocks(input) {
      return [...blocks.values()]
        .filter((b) => input.ownerId === undefined || b.ownerId === input.ownerId)
        .filter((b) => input.holder === undefined || b.holder === input.holder)
        .filter((b) => input.fates === undefined || input.fates.includes(b.fate))
        .filter((b) => input.reservedBefore === undefined || b.reservedAt < input.reservedBefore)
        .filter((b) => !input.unsettledOnly || b.settledAt === null)
        .sort((a, b) => a.reservedAt.localeCompare(b.reservedAt) || a.from - b.from)
        .slice(0, input.limit)
        .map((b) => stateOf(b, state.documents.values(), voids));
    },
    async closeContingencyBlock({ id, fate, usedUpTo, at }) {
      if (blocks.get(id)?.fate !== "OPEN") return false;
      update(id, { fate, usedUpTo, closedAt: at });
      return true;
    },
    async settleContingencyBlock({ id, at }) {
      update(id, { settledAt: at });
    },
    async recordContingencyVoid({ blockId, range }) {
      if (voids.some((v) => v.blockId === blockId && v.from === range.from)) return false;
      voids.push({ blockId, ...range });
      return true;
    },
    async getDocumentByAccessKey(ownerId, accessKey) {
      return [...state.documents.values()].find((d) => d.ownerId === ownerId && d.accessKey === accessKey) ?? null;
    },
    recordSignedDocument: async (document, event) => insertSigned(state, document, event),
  };
}
