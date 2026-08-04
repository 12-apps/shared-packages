/**
 * In-memory implementations of the four storage adapters. Used by this
 * package's tests and handy for prototyping a new host before wiring a real
 * database. NOT for production use — nothing persists.
 */

import { cloneJson } from './diff';
import type {
  ApprovalStore,
  ChangeRequestRecord,
  DraftRecord,
  DraftStatus,
  EntityRef,
  NewRecycleBinEntry,
  RecycleBinEntry,
  RecycleBinStatus,
  RecycleBinStore,
  Snapshot,
  VersionRecord,
  VersionStore,
} from './types';

let counter = 0;
const nextId = (prefix: string): string => {
  counter += 1;
  return `${prefix}_${counter}`;
};

const sameEntity = (row: EntityRef, ref: EntityRef): boolean =>
  row.tenantId === ref.tenantId &&
  row.entityType === ref.entityType &&
  row.entityId === ref.entityId;

export function createMemoryVersionStore(): VersionStore & { rows: VersionRecord[] } {
  const rows: VersionRecord[] = [];
  return {
    rows,
    async append(record) {
      const row: VersionRecord = {
        ...record,
        data: cloneJson(record.data),
        removedFields: [...record.removedFields],
        id: nextId('ver'),
        createdAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    async list(ref) {
      return rows
        .filter((row) => sameEntity(row, ref))
        .sort((a, b) => a.version - b.version);
    },
    async latest(ref) {
      const list = await this.list(ref);
      return list[list.length - 1] ?? null;
    },
    async deleteVersions(ref, versions) {
      const drop = new Set(versions);
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        const row = rows[i];
        if (row && sameEntity(row, ref) && drop.has(row.version)) rows.splice(i, 1);
      }
    },
    async promoteToSnapshot(ref, version, data) {
      const row = rows.find((r) => sameEntity(r, ref) && r.version === version);
      if (row) {
        row.isSnapshot = true;
        row.data = cloneJson(data);
        row.removedFields = [];
      }
    },
  };
}

export function createMemoryRecycleBinStore(): RecycleBinStore & { rows: RecycleBinEntry[] } {
  const rows: RecycleBinEntry[] = [];

  const insert = (
    tenantId: string,
    entry: NewRecycleBinEntry,
    deletedBy: string | null,
    parentEntryId: string | null,
  ): RecycleBinEntry => {
    const row: RecycleBinEntry = {
      id: nextId('bin'),
      tenantId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      parentEntryId,
      label: entry.label,
      snapshot: cloneJson(entry.snapshot),
      deletedBy,
      deletedAt: new Date(),
      status: 'DELETED',
    };
    rows.push(row);
    for (const child of entry.children ?? []) insert(tenantId, child, deletedBy, row.id);
    return row;
  };

  const descendants = (entryId: string): RecycleBinEntry[] => {
    const direct = rows.filter((row) => row.parentEntryId === entryId);
    return direct.flatMap((child) => [child, ...descendants(child.id)]);
  };

  return {
    rows,
    async addTree(tenantId, root, deletedBy) {
      return insert(tenantId, root, deletedBy, null);
    },
    async list(tenantId, filter) {
      return rows.filter(
        (row) =>
          row.tenantId === tenantId &&
          (filter?.entityType === undefined || row.entityType === filter.entityType) &&
          (filter?.status === undefined || row.status === filter.status) &&
          (filter?.rootsOnly === false || row.parentEntryId === null),
      );
    },
    async getTree(tenantId, entryId) {
      const root = rows.find((row) => row.tenantId === tenantId && row.id === entryId);
      if (!root) return [];
      return [root, ...descendants(root.id)];
    },
    async setStatus(tenantId, entryIds, status: RecycleBinStatus) {
      const ids = new Set(entryIds);
      for (const row of rows) {
        if (row.tenantId === tenantId && ids.has(row.id)) row.status = status;
      }
    },
  };
}

export function createMemoryDraftStore(): ReturnType<typeof buildDraftStore> {
  return buildDraftStore();
}

function buildDraftStore() {
  const rows: DraftRecord[] = [];
  const store = {
    rows,
    async upsertOpen(input: {
      tenantId: string;
      entityType: string;
      entityId: string | null;
      data: Snapshot;
      actorId: string | null;
    }): Promise<DraftRecord> {
      const existing =
        input.entityId === null
          ? undefined
          : rows.find(
              (row) =>
                row.tenantId === input.tenantId &&
                row.entityType === input.entityType &&
                row.entityId === input.entityId &&
                row.status === 'OPEN',
            );
      if (existing) {
        existing.data = cloneJson(input.data);
        existing.updatedBy = input.actorId;
        existing.updatedAt = new Date();
        return existing;
      }
      const row: DraftRecord = {
        id: nextId('draft'),
        tenantId: input.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        data: cloneJson(input.data),
        status: 'OPEN',
        createdBy: input.actorId,
        updatedBy: input.actorId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(row);
      return row;
    },
    async get(tenantId: string, draftId: string): Promise<DraftRecord | null> {
      return rows.find((row) => row.tenantId === tenantId && row.id === draftId) ?? null;
    },
    async getOpenFor(
      tenantId: string,
      entityType: string,
      entityId: string,
    ): Promise<DraftRecord | null> {
      return (
        rows.find(
          (row) =>
            row.tenantId === tenantId &&
            row.entityType === entityType &&
            row.entityId === entityId &&
            row.status === 'OPEN',
        ) ?? null
      );
    },
    async listOpen(tenantId: string, entityType?: string): Promise<DraftRecord[]> {
      return rows.filter(
        (row) =>
          row.tenantId === tenantId &&
          row.status === 'OPEN' &&
          (entityType === undefined || row.entityType === entityType),
      );
    },
    async setStatus(tenantId: string, draftId: string, status: DraftStatus): Promise<void> {
      const row = rows.find((r) => r.tenantId === tenantId && r.id === draftId);
      if (row) {
        row.status = status;
        row.updatedAt = new Date();
      }
    },
  };
  return store;
}

export function createMemoryApprovalStore(): ApprovalStore & { rows: ChangeRequestRecord[] } {
  const rows: ChangeRequestRecord[] = [];
  return {
    rows,
    async create(input) {
      const row: ChangeRequestRecord = {
        id: nextId('cr'),
        tenantId: input.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        payload: cloneJson(input.payload),
        status: 'PENDING',
        requestedBy: input.requestedBy,
        requestedAt: new Date(),
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
      };
      rows.push(row);
      return row;
    },
    async get(tenantId, requestId) {
      return rows.find((row) => row.tenantId === tenantId && row.id === requestId) ?? null;
    },
    async list(tenantId, filter) {
      return rows.filter(
        (row) =>
          row.tenantId === tenantId &&
          (filter?.entityType === undefined || row.entityType === filter.entityType) &&
          (filter?.entityId === undefined || row.entityId === filter.entityId) &&
          (filter?.status === undefined || row.status === filter.status),
      );
    },
    async decide(tenantId, requestId, decision) {
      const row = rows.find((r) => r.tenantId === tenantId && r.id === requestId);
      // Compare-and-set: only a PENDING request can be decided, and only one
      // caller wins the transition.
      if (!row || row.status !== 'PENDING') return false;
      row.status = decision.status;
      row.decidedBy = decision.decidedBy;
      row.decidedAt = new Date();
      row.decisionNote = decision.decisionNote;
      return true;
    },
    async reopen(tenantId, requestId) {
      const row = rows.find((r) => r.tenantId === tenantId && r.id === requestId);
      if (row) {
        row.status = 'PENDING';
        row.decidedBy = null;
        row.decidedAt = null;
        row.decisionNote = null;
      }
    },
  };
}
