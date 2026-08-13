import { inboxWire, type ListNotificationsResult } from '../wire';

import type {
  NotificationDelegate,
  NotificationPageAfter,
  NotificationsDbProvider,
  NotificationWhere,
} from './db';

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
  /**
   * Cursor = the `id` of the last item of the previous page. Resolved to a
   * KEYSET position, so a row the user soft-deleted between the two requests —
   * routinely the bottom one, since that is the row with the delete button —
   * still anchors the next page instead of costing it a row. Owner-checked: an
   * id that is not the caller's names no position and answers an empty page.
   */
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

/**
 * Resolve a cursor into a keyset anchor, or refuse it.
 *
 * OWNERSHIP-CHECKED, which the positional cursor never was: `cursor` is a raw
 * client value, and while the `where` kept the ROWS the caller's own, the
 * anchor's position leaked the `created_at` of whatever row the id named.
 * `undefined` here means "this cursor names no position in your list" and the
 * caller answers an empty page — the anchor is not `deletedAt`-filtered, so the
 * only way to reach that is a foreign or invented id.
 */
async function resolveAnchor(
  notifications: NotificationDelegate,
  userId: string,
  cursor: string,
): Promise<NotificationPageAfter | undefined> {
  const anchor = await notifications.findUnique({ where: { id: cursor } });
  if (!anchor || anchor.userId !== userId) return undefined;
  return { createdAt: anchor.createdAt, id: anchor.id };
}

/** The whole read filter for one page: owner, live, filter, page boundary. */
function pageWhere(
  userId: string,
  filter: ListNotificationsInput['filter'],
  anchor: NotificationPageAfter | undefined,
): NotificationWhere {
  return {
    userId,
    deletedAt: null,
    ...(filter === 'unread' ? { readAt: null } : {}),
    // `(createdAt, id) < (anchor.createdAt, anchor.id)`, as a portable `where`.
    ...(anchor
      ? {
          OR: [
            { createdAt: { lt: anchor.createdAt } },
            { createdAt: anchor.createdAt, id: { lt: anchor.id } },
          ] as NonNullable<NotificationWhere['OR']>,
        }
      : {}),
  };
}

export function createInboxStore(db: NotificationsDbProvider): NotificationInboxStore {
  return {
    /** The owner's inbox, newest first, keyset-paginated, deleted excluded. */
    async list(userId, input = {}) {
      const client = await db();
      const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
      const anchor = input.cursor
        ? await resolveAnchor(client.notification, userId, input.cursor)
        : undefined;
      if (input.cursor && !anchor) return { items: [], nextCursor: null };
      const rows = await client.notification.findMany({
        where: pageWhere(userId, input.filter, anchor),
        // `id` tie-breaks equal timestamps so pages never skip/repeat.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
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
