/**
 * The inbox WIRE shape — the one contract the two halves share.
 *
 * It lives in the root entry rather than in `./server` or `./react` because
 * both halves need it and neither owns it: the api serializes to it, the panel
 * deserializes from it, and a change here is a change to both at once. That is
 * the same reason the response envelope and the route paths are the package's
 * and not the host's.
 */

/** One inbox entry as the notification centre renders it. */
export interface InboxNotification {
  id: string;
  type: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
  /** ISO-8601, or null while unread. */
  readAt: string | null;
  /** ISO-8601. */
  createdAt: string;
}

/** One page of the owner's inbox. */
export interface ListNotificationsResult {
  items: InboxNotification[];
  /** Cursor for the next page, or null when this page is the last. */
  nextCursor: string | null;
}

/** A stored notification row, as the db seam hands it back. */
export interface NotificationRow {
  id: string;
  userId: string;
  clientId: string | null;
  type: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
  data: unknown;
  readAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

/** Row → wire. Dates become ISO strings; a null `data` becomes `{}`. */
export function inboxWire(row: NotificationRow): InboxNotification {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    title: row.title,
    body: row.body,
    link: row.link,
    data: (row.data ?? {}) as Record<string, unknown>,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
