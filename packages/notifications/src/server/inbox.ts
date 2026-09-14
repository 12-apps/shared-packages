import { inboxWire, type ListNotificationsResult } from '../wire';

import type {
  NotificationDelegate,
  NotificationPageAfter,
  NotificationsDbProvider,
  NotificationWhere,
  NotificationWhereBranch,
} from './db';

/**
 * Notification-centre inbox reads/writes. Every function is scoped to the
 * OWNER's `userId` — a caller can only ever see or touch their own rows (the
 * route layer supplies the authenticated user's id, never a client value).
 * Soft-deleted rows (`deletedAt` set) are excluded from every read and can
 * never be resurrected by mark-read.
 */

/**
 * The store whose ORIGIN the caller is reading from, or absent for the platform
 * origin.
 *
 * A host that installs one storefront per store as its own PWA reads this from
 * the request's hostname; a host with one origin never sets it and every read
 * below is exactly what it was. Set, it narrows to that store's rows PLUS the
 * platform-wide ones (`clientId IS NULL`) — a password reset or a security
 * notice is about the person and not about a store, so hiding it inside the
 * only app a customer opens would be a worse failure than the leak this fixes.
 */
export type NotificationScope = string | undefined;

/**
 * `clientId IN (<scope>, NULL)`, as a filter branch — or nothing at all.
 *
 * A disjunction rather than an `in`, because SQL `IN` never matches NULL and
 * the NULL rows are precisely the ones that must survive every scope.
 */
function scopeBranch(scope: NotificationScope): NotificationWhereBranch[] {
  return scope === undefined ? [] : [{ OR: [{ clientId: scope }, { clientId: null }] }];
}

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
  list(
    userId: string,
    input?: ListNotificationsInput,
    scope?: NotificationScope,
  ): Promise<ListNotificationsResult>;
  /** Scoped with `list`, or the badge and the list it sits over disagree. */
  unreadCount(userId: string, scope?: NotificationScope): Promise<number>;
  markRead(userId: string, ids: readonly string[]): Promise<number>;
  /**
   * Scoped too, and this one is a WRITE.
   *
   * Unscoped, "mark all as read" pressed inside store A's app clears store B's
   * unread rows everywhere — a cross-store write from the app that exists to be
   * isolated, and strictly worse than the read leak. `markRead(ids)` and
   * `softDelete(ids)` need nothing: their ids come from the already-scoped list.
   *
   * The platform-wide rows ARE cleared from any origin, and that follows from
   * the scope rule rather than contradicting it — those rows are one person's,
   * not one store's.
   */
  markAllRead(userId: string, scope?: NotificationScope): Promise<number>;
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
  scope: NotificationScope,
): NotificationWhere {
  // Two DISJUNCTIONS have to hold at once — the page boundary and the store
  // scope — so they are AND-ed rather than merged. A second `OR` key on this
  // object literal would overwrite the first, dropping either the scope or the
  // anchor; the anchor only from page TWO onward, which is the case a cursor
  // exists for and the case a single-page test never reaches.
  const clauses: NotificationWhereBranch[] = [
    // `(createdAt, id) < (anchor.createdAt, anchor.id)`, as a portable `where`.
    ...(anchor
      ? [
          {
            OR: [
              { createdAt: { lt: anchor.createdAt } },
              { createdAt: anchor.createdAt, id: { lt: anchor.id } },
            ],
          },
        ]
      : []),
    ...scopeBranch(scope),
  ];
  return {
    userId,
    deletedAt: null,
    ...(filter === 'unread' ? { readAt: null } : {}),
    ...(clauses.length > 0 ? { AND: clauses } : {}),
  };
}

export function createInboxStore(db: NotificationsDbProvider): NotificationInboxStore {
  return {
    /** The owner's inbox, newest first, keyset-paginated, deleted excluded. */
    async list(userId, input = {}, scope) {
      const client = await db();
      const limit = Math.min(Math.max(input.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
      const anchor = input.cursor
        ? await resolveAnchor(client.notification, userId, input.cursor)
        : undefined;
      if (input.cursor && !anchor) return { items: [], nextCursor: null };
      const rows = await client.notification.findMany({
        where: pageWhere(userId, input.filter, anchor, scope),
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
    async unreadCount(userId, scope) {
      const client = await db();
      const scoped = scopeBranch(scope);
      return client.notification.count({
        where: {
          userId,
          deletedAt: null,
          readAt: null,
          ...(scoped.length > 0 ? { AND: scoped } : {}),
        },
      });
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
    async markAllRead(userId, scope) {
      const client = await db();
      const scoped = scopeBranch(scope);
      const result = await client.notification.updateMany({
        where: {
          userId,
          deletedAt: null,
          readAt: null,
          ...(scoped.length > 0 ? { AND: scoped } : {}),
        },
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
