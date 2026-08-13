/* eslint-disable test-flakiness/no-global-state-mutation, test-flakiness/no-random-data --
   this file IS the database of the unit suite: rows are mutable storage by
   design (an UPDATE mutates the stored row exactly as a table would), and
   `new Date()` stamps rows the way a column default does — no assertion ever
   reads a wall-clock value. */
/**
 * An in-memory {@link LifecycleDb} for the unit suite — the smallest possible
 * proof that the seam's CLOSED shapes are implementable without Prisma
 * (the harness proves it again over a real Postgres). Filters implement only
 * the argument shapes `src/server/stores.ts` actually passes.
 */

import type {
  ChangeRequestRow,
  EntityDraftRow,
  EntityVersionRow,
  LifecycleDb,
  LifecycleDbClient,
  RecycleBinRow,
} from '../db';

interface MemoryState {
  versions: EntityVersionRow[];
  bin: RecycleBinRow[];
  drafts: EntityDraftRow[];
  requests: ChangeRequestRow[];
}

let sequence = 0;
const nextId = (prefix: string): string => `${prefix}-${++sequence}`;

const byNumber =
  (direction: 'asc' | 'desc') =>
  (a: number, b: number): number =>
    direction === 'asc' ? a - b : b - a;

const byDate =
  (direction: 'asc' | 'desc') =>
  (a: Date, b: Date): number =>
    direction === 'asc' ? a.getTime() - b.getTime() : b.getTime() - a.getTime();

function client(state: MemoryState): LifecycleDbClient {
  return {
    entityVersion: {
      async create({ data }) {
        const row: EntityVersionRow = {
          id: nextId('v'),
          clientId: data.clientId,
          entityType: data.entityType,
          entityId: data.entityId,
          version: data.version,
          kind: data.kind,
          isSnapshot: data.isSnapshot,
          data: data.data,
          removedFields: data.removedFields,
          actorId: data.actorId,
          restoredFrom: data.restoredFrom,
          createdAt: new Date(),
        };
        state.versions.push(row);
        return row;
      },
      async findMany({ where, orderBy }) {
        return state.versions
          .filter(
            (row) =>
              row.clientId === where.clientId &&
              row.entityType === where.entityType &&
              row.entityId === where.entityId,
          )
          .sort((a, b) => byNumber(orderBy.version)(a.version, b.version));
      },
      async findFirst({ where, orderBy }) {
        const rows = await this.findMany({ where, orderBy });
        return rows[0] ?? null;
      },
      async deleteMany({ where }) {
        const versions = typeof where.version === 'object' ? where.version.in : null;
        const before = state.versions.length;
        state.versions = state.versions.filter(
          (row) =>
            !(
              row.clientId === where.clientId &&
              row.entityType === where.entityType &&
              row.entityId === where.entityId &&
              (versions === null || versions.includes(row.version))
            ),
        );
        return { count: before - state.versions.length };
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of state.versions) {
          if (
            row.clientId === where.clientId &&
            row.entityType === where.entityType &&
            row.entityId === where.entityId &&
            row.version === where.version
          ) {
            row.isSnapshot = data.isSnapshot;
            row.data = data.data;
            row.removedFields = data.removedFields;
            count += 1;
          }
        }
        return { count };
      },
    },
    recycleBinEntry: {
      async create({ data }) {
        const row: RecycleBinRow = {
          id: nextId('bin'),
          clientId: data.clientId,
          entityType: data.entityType,
          entityId: data.entityId,
          parentEntryId: data.parentEntryId,
          label: data.label,
          snapshot: data.snapshot,
          status: 'DELETED',
          deletedBy: data.deletedBy,
          deletedAt: new Date(),
        };
        state.bin.push(row);
        return row;
      },
      async findFirst({ where }) {
        return (
          state.bin.find((row) => row.clientId === where.clientId && row.id === where.id) ?? null
        );
      },
      async findMany({ where, orderBy }) {
        return state.bin
          .filter((row) => {
            if (row.clientId !== where.clientId) return false;
            if (where.entityType !== undefined && row.entityType !== where.entityType)
              return false;
            if (where.status !== undefined && row.status !== where.status) return false;
            if (where.parentEntryId === null && row.parentEntryId !== null) return false;
            if (
              typeof where.parentEntryId === 'object' &&
              where.parentEntryId !== null &&
              (row.parentEntryId === null ||
                !where.parentEntryId.in.includes(row.parentEntryId))
            )
              return false;
            return true;
          })
          .sort((a, b) => byDate(orderBy.deletedAt)(a.deletedAt, b.deletedAt));
      },
      async updateMany({ where, data }) {
        const ids = typeof where.id === 'object' && where.id !== null ? where.id.in : null;
        let count = 0;
        for (const row of state.bin) {
          if (row.clientId !== where.clientId) continue;
          if (ids !== null ? !ids.includes(row.id) : where.id !== undefined && row.id !== where.id)
            continue;
          row.status = data.status;
          count += 1;
        }
        return { count };
      },
    },
    entityDraft: {
      async create({ data }) {
        const now = new Date();
        const row: EntityDraftRow = {
          id: nextId('draft'),
          clientId: data.clientId,
          entityType: data.entityType,
          entityId: data.entityId,
          data: data.data,
          status: 'OPEN',
          createdBy: data.createdBy,
          updatedBy: data.updatedBy,
          createdAt: now,
          updatedAt: now,
        };
        state.drafts.push(row);
        return row;
      },
      async update({ where, data }) {
        const row = state.drafts.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error(`Draft ${where.id} not found`);
        row.data = data.data;
        row.updatedBy = data.updatedBy;
        row.updatedAt = new Date();
        return row;
      },
      async findFirst({ where }) {
        return (
          state.drafts.find(
            (row) =>
              row.clientId === where.clientId &&
              (where.id === undefined || row.id === where.id) &&
              (where.entityType === undefined || row.entityType === where.entityType) &&
              (where.entityId === undefined || row.entityId === where.entityId) &&
              (where.status === undefined || row.status === where.status),
          ) ?? null
        );
      },
      async findMany({ where, orderBy }) {
        return state.drafts
          .filter(
            (row) =>
              row.clientId === where.clientId &&
              (where.entityType === undefined || row.entityType === where.entityType) &&
              (where.status === undefined || row.status === where.status),
          )
          .sort((a, b) => byDate(orderBy.updatedAt)(a.updatedAt, b.updatedAt));
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of state.drafts) {
          if (row.clientId !== where.clientId) continue;
          if (where.id !== undefined && row.id !== where.id) continue;
          row.status = data.status;
          count += 1;
        }
        return { count };
      },
    },
    changeRequest: {
      async create({ data }) {
        const row: ChangeRequestRow = {
          id: nextId('cr'),
          clientId: data.clientId,
          entityType: data.entityType,
          entityId: data.entityId,
          action: data.action,
          payload: data.payload,
          status: 'PENDING',
          requestedBy: data.requestedBy,
          requestedAt: new Date(),
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
        };
        state.requests.push(row);
        return row;
      },
      async findFirst({ where }) {
        return (
          state.requests.find(
            (row) => row.clientId === where.clientId && row.id === where.id,
          ) ?? null
        );
      },
      async findMany({ where, orderBy }) {
        return state.requests
          .filter(
            (row) =>
              row.clientId === where.clientId &&
              (where.entityType === undefined || row.entityType === where.entityType) &&
              (where.entityId === undefined || row.entityId === where.entityId) &&
              (where.status === undefined || row.status === where.status),
          )
          .sort((a, b) => byDate(orderBy.requestedAt)(a.requestedAt, b.requestedAt));
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of state.requests) {
          if (row.clientId !== where.clientId) continue;
          if (where.id !== undefined && row.id !== where.id) continue;
          if (where.status !== undefined && row.status !== where.status) continue;
          row.status = data.status;
          row.decidedBy = data.decidedBy;
          row.decidedAt = data.decidedAt;
          row.decisionNote = data.decisionNote;
          count += 1;
        }
        return { count };
      },
    },
  };
}

export function createMemoryLifecycleDb(): LifecycleDb {
  const state: MemoryState = { versions: [], bin: [], drafts: [], requests: [] };
  const base = client(state);
  return {
    ...base,
    // The unit suite needs atomicity's SHAPE, not its guarantees — the
    // harness proves real transactions over a real Postgres.
    $transaction: (fn) => fn(base),
  };
}
