/**
 * The draft rows' mapping, and the opt-in new-item draft methods over the
 * same `entity_drafts` table (FUT-3244, `../new-item-drafts`). Split from
 * `./stores` only for its length.
 */

import type { NewItemDraftStore } from '../new-item-drafts';
import type { DraftRecord, DraftStatus } from '../types';

import { asSnapshot, type EntityDraftRow, type LifecycleDbProvider } from './db';

export const toDraftRecord = (row: EntityDraftRow): DraftRecord => ({
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

/** The opt-in new-item draft methods, on the draft store's own table. */
export function createNewItemDraftStore(db: LifecycleDbProvider): NewItemDraftStore {
  return {
    async updateOpen({ tenantId, draftId, data, actorId }) {
      const client = await db();
      // Conditional on OPEN in the one statement: a publish that lands first
      // makes this a no-op rather than a write over a published row.
      const { count } = await client.entityDraft.updateMany({
        where: { clientId: tenantId, id: draftId, status: 'OPEN' },
        data: { data, updatedBy: actorId },
      });
      if (count === 0) return null;
      const row = await client.entityDraft.findFirst({ where: { clientId: tenantId, id: draftId } });
      return row ? toDraftRecord(row) : null;
    },
    async latestOpenNewBy(tenantId, entityType, actorId) {
      const client = await db();
      const row = await client.entityDraft.findFirst({
        where: { clientId: tenantId, entityType, entityId: null, status: 'OPEN', createdBy: actorId },
        orderBy: { updatedAt: 'desc' },
      });
      return row ? toDraftRecord(row) : null;
    },
    async deleteOpenNewBefore(entityType, before) {
      const client = await db();
      if (!client.entityDraft.deleteMany) {
        throw new Error('The lifecycle db seam has no entityDraft.deleteMany; the sweep needs it.');
      }
      const { count } = await client.entityDraft.deleteMany({
        where: { entityType, entityId: null, status: 'OPEN', updatedAt: { lt: before } },
      });
      return count;
    },
  };
}
