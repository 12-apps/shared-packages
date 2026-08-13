/**
 * The {@link LifecycleStores} bundle over the four tables this package owns
 * (12-17) — the port of future-pay's `lib/lifecycle/stores.ts` +
 * `store-versions.ts`, generalized onto the structural {@link LifecycleDb}
 * seam so a host passes its Prisma client and a harness passes SQL.
 *
 * One bundle serves EVERY registered collection — a new entity type reuses
 * these stores untouched. Reads are DELIBERATE about visibility: the bin list
 * filters `status` explicitly, drafts filter `status: 'OPEN'` explicitly —
 * nothing here relies on a host client's default filters (FUT-807 is a host
 * convenience these seam-fed reads cannot assume).
 */

import type {
  ApprovalStore,
  ChangeRequestAction,
  ChangeRequestRecord,
  ChangeRequestStatus,
  DraftRecord,
  DraftStatus,
  DraftStore,
  LifecycleStores,
  NewRecycleBinEntry,
  RecycleBinEntry,
  RecycleBinStatus,
  RecycleBinStore,
  VersionKind,
  VersionRecord,
  VersionStore,
} from '../types';

import {
  asSnapshot,
  asStringArray,
  type ChangeRequestRow,
  type EntityDraftRow,
  type EntityVersionRow,
  type LifecycleDbProvider,
  type RecycleBinRow,
} from './db';

const toVersionRecord = (row: EntityVersionRow): VersionRecord => ({
  id: row.id,
  tenantId: row.clientId,
  entityType: row.entityType,
  entityId: row.entityId,
  version: row.version,
  kind: row.kind as VersionKind,
  isSnapshot: row.isSnapshot,
  data: asSnapshot(row.data),
  removedFields: asStringArray(row.removedFields),
  actorId: row.actorId,
  createdAt: row.createdAt,
  restoredFromVersion: row.restoredFrom,
});

function createVersionStore(db: LifecycleDbProvider): VersionStore {
  return {
    async append(record) {
      const client = await db();
      const row = await client.entityVersion.create({
        data: {
          clientId: record.tenantId,
          entityType: record.entityType,
          entityId: record.entityId,
          version: record.version,
          kind: record.kind,
          isSnapshot: record.isSnapshot,
          data: record.data,
          removedFields: [...record.removedFields],
          actorId: record.actorId,
          restoredFrom: record.restoredFromVersion,
        },
      });
      return toVersionRecord(row);
    },
    async list(ref) {
      const client = await db();
      const rows = await client.entityVersion.findMany({
        where: { clientId: ref.tenantId, entityType: ref.entityType, entityId: ref.entityId },
        orderBy: { version: 'asc' },
      });
      return rows.map(toVersionRecord);
    },
    async latest(ref) {
      const client = await db();
      const row = await client.entityVersion.findFirst({
        where: { clientId: ref.tenantId, entityType: ref.entityType, entityId: ref.entityId },
        orderBy: { version: 'desc' },
      });
      return row ? toVersionRecord(row) : null;
    },
    async deleteVersions(ref, versions) {
      const client = await db();
      await client.entityVersion.deleteMany({
        where: {
          clientId: ref.tenantId,
          entityType: ref.entityType,
          entityId: ref.entityId,
          version: { in: [...versions] },
        },
      });
    },
    async promoteToSnapshot(ref, version, data) {
      const client = await db();
      await client.entityVersion.updateMany({
        where: {
          clientId: ref.tenantId,
          entityType: ref.entityType,
          entityId: ref.entityId,
          version,
        },
        data: { isSnapshot: true, data, removedFields: [] },
      });
    },
  };
}

const toBinEntry = (row: RecycleBinRow): RecycleBinEntry => ({
  id: row.id,
  tenantId: row.clientId,
  entityType: row.entityType,
  entityId: row.entityId,
  parentEntryId: row.parentEntryId,
  label: row.label,
  snapshot: asSnapshot(row.snapshot),
  deletedBy: row.deletedBy,
  deletedAt: row.deletedAt,
  status: row.status as RecycleBinStatus,
});

function createRecycleBinStore(db: LifecycleDbProvider): RecycleBinStore {
  return {
    async addTree(tenantId, root, deletedBy) {
      const client = await db();
      // Insert the tree inside one transaction so a failure never leaves a
      // parentless child registry behind.
      return client.$transaction(async (tx) => {
        const insert = async (
          entry: NewRecycleBinEntry,
          parentEntryId: string | null,
        ): Promise<RecycleBinRow> => {
          const row = await tx.recycleBinEntry.create({
            data: {
              clientId: tenantId,
              entityType: entry.entityType,
              entityId: entry.entityId,
              parentEntryId,
              label: entry.label,
              snapshot: entry.snapshot,
              deletedBy,
            },
          });
          for (const child of entry.children ?? []) await insert(child, row.id);
          return row;
        };
        return toBinEntry(await insert(root, null));
      });
    },
    async list(tenantId, filter) {
      const client = await db();
      const rows = await client.recycleBinEntry.findMany({
        where: {
          clientId: tenantId,
          ...(filter?.entityType !== undefined ? { entityType: filter.entityType } : {}),
          ...(filter?.status !== undefined ? { status: filter.status } : {}),
          ...(filter?.rootsOnly === false ? {} : { parentEntryId: null }),
        },
        orderBy: { deletedAt: 'desc' },
      });
      return rows.map(toBinEntry);
    },
    async getTree(tenantId, entryId) {
      const client = await db();
      const root = await client.recycleBinEntry.findFirst({
        where: { clientId: tenantId, id: entryId },
      });
      if (!root) return [];
      // Depth is tiny (root + direct dependents today), so a per-level fetch is
      // fine and keeps the query portable (no recursive CTE on PGlite).
      const entries: RecycleBinRow[] = [root];
      let frontier = [root.id];
      while (frontier.length > 0) {
        const children = await client.recycleBinEntry.findMany({
          where: { clientId: tenantId, parentEntryId: { in: frontier } },
          orderBy: { deletedAt: 'asc' },
        });
        entries.push(...children);
        frontier = children.map((child) => child.id);
      }
      return entries.map(toBinEntry);
    },
    async setStatus(tenantId, entryIds, status) {
      const client = await db();
      await client.recycleBinEntry.updateMany({
        where: { clientId: tenantId, id: { in: [...entryIds] } },
        data: { status },
      });
    },
  };
}

const toDraftRecord = (row: EntityDraftRow): DraftRecord => ({
  id: row.id,
  tenantId: row.clientId,
  entityType: row.entityType,
  entityId: row.entityId,
  data: asSnapshot(row.data),
  status: row.status as DraftStatus,
  createdBy: row.createdBy,
  updatedBy: row.updatedBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

function createDraftStore(db: LifecycleDbProvider): DraftStore {
  return {
    async upsertOpen(input) {
      const client = await db();
      const existing =
        input.entityId === null
          ? null
          : await client.entityDraft.findFirst({
              where: {
                clientId: input.tenantId,
                entityType: input.entityType,
                entityId: input.entityId,
                status: 'OPEN',
              },
            });
      if (existing) {
        const row = await client.entityDraft.update({
          where: { id: existing.id },
          data: { data: input.data, updatedBy: input.actorId },
        });
        return toDraftRecord(row);
      }
      const row = await client.entityDraft.create({
        data: {
          clientId: input.tenantId,
          entityType: input.entityType,
          entityId: input.entityId,
          data: input.data,
          createdBy: input.actorId,
          updatedBy: input.actorId,
        },
      });
      return toDraftRecord(row);
    },
    async get(tenantId, draftId) {
      const client = await db();
      const row = await client.entityDraft.findFirst({
        where: { clientId: tenantId, id: draftId },
      });
      return row ? toDraftRecord(row) : null;
    },
    async getOpenFor(tenantId, entityType, entityId) {
      const client = await db();
      const row = await client.entityDraft.findFirst({
        where: { clientId: tenantId, entityType, entityId, status: 'OPEN' },
      });
      return row ? toDraftRecord(row) : null;
    },
    async listOpen(tenantId, entityType) {
      const client = await db();
      const rows = await client.entityDraft.findMany({
        where: {
          clientId: tenantId,
          status: 'OPEN',
          ...(entityType !== undefined ? { entityType } : {}),
        },
        orderBy: { updatedAt: 'desc' },
      });
      return rows.map(toDraftRecord);
    },
    async setStatus(tenantId, draftId, status) {
      const client = await db();
      await client.entityDraft.updateMany({
        where: { clientId: tenantId, id: draftId },
        data: { status },
      });
    },
  };
}

const toRequestRecord = (row: ChangeRequestRow): ChangeRequestRecord => ({
  id: row.id,
  tenantId: row.clientId,
  entityType: row.entityType,
  entityId: row.entityId,
  action: row.action as ChangeRequestAction,
  payload: asSnapshot(row.payload),
  status: row.status as ChangeRequestStatus,
  requestedBy: row.requestedBy,
  requestedAt: row.requestedAt,
  decidedBy: row.decidedBy,
  decidedAt: row.decidedAt,
  decisionNote: row.decisionNote,
});

function createApprovalStore(db: LifecycleDbProvider): ApprovalStore {
  return {
    async create(input) {
      const client = await db();
      const row = await client.changeRequest.create({
        data: {
          clientId: input.tenantId,
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          payload: input.payload,
          requestedBy: input.requestedBy,
        },
      });
      return toRequestRecord(row);
    },
    async get(tenantId, requestId) {
      const client = await db();
      const row = await client.changeRequest.findFirst({
        where: { clientId: tenantId, id: requestId },
      });
      return row ? toRequestRecord(row) : null;
    },
    async list(tenantId, filter) {
      const client = await db();
      const rows = await client.changeRequest.findMany({
        where: {
          clientId: tenantId,
          ...(filter?.entityType !== undefined ? { entityType: filter.entityType } : {}),
          ...(filter?.entityId !== undefined ? { entityId: filter.entityId } : {}),
          ...(filter?.status !== undefined ? { status: filter.status } : {}),
        },
        orderBy: { requestedAt: 'desc' },
      });
      return rows.map(toRequestRecord);
    },
    async decide(tenantId, requestId, decision) {
      const client = await db();
      // Compare-and-set on PENDING: of two concurrent deciders exactly one
      // matches a row here, so a parked write can never be applied twice.
      const result = await client.changeRequest.updateMany({
        where: { clientId: tenantId, id: requestId, status: 'PENDING' },
        data: {
          status: decision.status,
          decidedBy: decision.decidedBy,
          decidedAt: new Date(),
          decisionNote: decision.decisionNote,
        },
      });
      return result.count > 0;
    },
    async reopen(tenantId, requestId) {
      const client = await db();
      // Compensation for a claim whose apply failed: back to PENDING, retryable.
      await client.changeRequest.updateMany({
        where: { clientId: tenantId, id: requestId },
        data: { status: 'PENDING', decidedBy: null, decidedAt: null, decisionNote: null },
      });
    },
  };
}

/** The one adapter bundle every registered collection shares. */
export function createDbLifecycleStores(db: LifecycleDbProvider): LifecycleStores {
  return {
    versions: createVersionStore(db),
    recycleBin: createRecycleBinStore(db),
    drafts: createDraftStore(db),
    approvals: createApprovalStore(db),
  };
}
