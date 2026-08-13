import { inboxWire, type ListNotificationsResult } from '../wire';

import type { NotificationsDbProvider } from './db';

/**
 * Notification-centre inbox reads/writes. Every function is scoped to the
 * OWNER's `userId` — a caller can only ever see or touch their own rows (the
 * route layer supplies the authenticated user's id, never a client value).
 * Soft-deleted rows (`deletedAt` set) are excluded from every read and can
 * never be resurrected by mark-read.
 */

export interface ListNotificationsInput {
  /** `unread` narrows to unread rows; default lists all non-deleted. */
  filter?: 'all' | 'unread';
  /** Cursor = the `id` of the last item of the previous page. */
  cursor?: string;
  /** Page size (server-clamped 1..100, default 20). */
  limit?: number;
}

const DEFAULT_PAGE = 20;
const MAX_PAGE = 100;

export interface NotificationInboxStore {
  list(userId: string, input?: ListNotificationsInput): Promise<ListNotificationsResult>;
  unreadCount(userId: string): Promise<number>;
  markRead(userId: string, ids: readonly string[]): Promise<number>;
  markAllRead(userId: string): Promise<number>;
  softDelete(userId: string, ids: readonly string[]): Promise<number>;
}

export function createInboxStore(db: NotificationsDbProvider): NotificationInboxStore {
  return {
    /** The owner's inbox, newest first, cursor-paginated, deleted excluded. */
    async list(userId, input = {}) {
      const client = await db();
      const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
      const rows = await client.notification.findMany({
        where: {
          userId,
          deletedAt: null,
          ...(input.filter === 'unread' ? { readAt: null } : {}),
        },
        // `id` tie-breaks equal timestamps so cursor pages never skip/repeat.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map(inboxWire),
        nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
      };
    },

    /** Unread badge count (non-deleted, unread). */
    async unreadCount(userId) {
      const client = await db();
      return client.notification.count({ where: { userId, deletedAt: null, readAt: null } });
    },

    /**
     * Mark specific notifications read. Only the owner's own, still-unread,
     * non-deleted rows are touched — foreign or already-read ids are silently
     * ignored (idempotent). Returns how many rows flipped.
     */
    async markRead(userId, ids) {
      if (ids.length === 0) return 0;
      const client = await db();
      const result = await client.notification.updateMany({
        where: { id: { in: [...ids] }, userId, deletedAt: null, readAt: null },
        data: { readAt: new Date() },
      });
      return result.count;
    },

    /** Mark every unread notification of the owner read ("mark all"). */
    async markAllRead(userId) {
      const client = await db();
      const result = await client.notification.updateMany({
        where: { userId, deletedAt: null, readAt: null },
        data: { readAt: new Date() },
      });
      return result.count;
    },

    /**
     * Soft-delete notifications (single or bulk): stamps `deletedAt` so the
     * rows drop out of every list/count forever, while the delivery audit
     * trail under them survives. Owner-scoped and idempotent like mark-read.
     */
    async softDelete(userId, ids) {
      if (ids.length === 0) return 0;
      const client = await db();
      const result = await client.notification.updateMany({
        where: { id: { in: [...ids] }, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      return result.count;
    },
  };
}
