import { liveSubjectOf } from '../live';
import { inboxWire, type ListNotificationsResult, type NotificationRow } from '../wire';

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

/**
 * How many unread rows {@link NotificationInboxStore.unreadSummary} reads
 * before it stops being exact about live subjects.
 *
 * The breakdown exists so a bell can avoid counting one happening thing twice,
 * and the badge it feeds renders `99+` above 99 — so a reader with more than a
 * hundred unread rows is already being told "a lot" rather than a number, and
 * an over-count hidden inside "a lot" is not a defect anyone can see. Below the
 * cap it is exact, which is every real inbox.
 *
 * The alternative was a JSON-path `where`, which is exact at any size and is
 * PostgreSQL-shaped: it would have put a Prisma JSON filter into
 * `NotificationWhere`, and that type is the CLOSED contract two non-Prisma
 * implementations of the db seam satisfy today (see `./db`).
 */
const SUBJECT_SCAN_CAP = 100;

/**
 * The badge's whole input: how many unread rows there are, and how many of them
 * are about a subject that may currently be LIVE on the reader's screen.
 *
 * The two numbers are separate because only the client can join them. A live
 * activity is published by the host through a React hook — this package's
 * server half has no idea what is happening right now, by design — so the
 * server answers "these unread rows are about `order:42`" and the surface,
 * which knows whether `order:42` is on screen, decides whether they still count.
 */
export interface UnreadSummary {
  /** Every unread, non-deleted row. The number the badge showed before. */
  total: number;
  /**
   * How many of those name a live subject, keyed by the subject.
   *
   * Only subjects with at least one unread row appear, so `{}` — the answer for
   * most inboxes — costs nothing on the wire. Counts, not a set: two unread
   * stages of one pedido must subtract two.
   */
  byLiveSubject: Readonly<Record<string, number>>;
}

export interface NotificationInboxStore {
  list(userId: string, input?: ListNotificationsInput): Promise<ListNotificationsResult>;
  unreadCount(userId: string): Promise<number>;
  /** The count above, plus the live-subject breakdown — see {@link UnreadSummary}. */
  unreadSummary(userId: string): Promise<UnreadSummary>;
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

/** Every unread row this owner still has. The badge's filter, in one place. */
function unreadWhere(userId: string): NotificationWhere {
  return { userId, deletedAt: null, readAt: null };
}

/** Unread rows -> how many name each live subject. Rows naming none are skipped. */
function tallyLiveSubjects(rows: readonly NotificationRow[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const row of rows) {
    const subject = liveSubjectOf(row.data as Record<string, unknown> | null);
    if (subject !== null) tally[subject] = (tally[subject] ?? 0) + 1;
  }
  return tally;
}

/**
 * The badge count AND its live-subject breakdown.
 *
 * Two queries, and the second is skipped whenever the first says zero — which
 * is the answer for most readers on most polls, so the ambient cost of the
 * breakdown is nothing at all. When there IS something unread, the scan is
 * bounded by {@link SUBJECT_SCAN_CAP} and ordered newest-first, so what it
 * reads is the part of the inbox a live subject can plausibly be in.
 */
async function unreadSummary(
  db: NotificationsDbProvider,
  userId: string,
): Promise<UnreadSummary> {
  const client = await db();
  const total = await client.notification.count({ where: unreadWhere(userId) });
  if (total === 0) return { total, byLiveSubject: {} };
  const rows = await client.notification.findMany({
    where: unreadWhere(userId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: SUBJECT_SCAN_CAP,
  });
  return { total, byLiveSubject: tallyLiveSubjects(rows) };
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
      return client.notification.count({ where: unreadWhere(userId) });
    },

    unreadSummary: (userId) => unreadSummary(db, userId),

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
