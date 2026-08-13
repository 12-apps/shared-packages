import type { InboxNotification } from '../wire';

import type { NotificationsApiClient } from './api';

/**
 * The inbox's client state, as ONE store shared by the bell and the panel.
 *
 * They have to share it: marking a row read in the panel must move the badge in
 * the same tick, and an arrival must add a row to the list AND to the count.
 * future-pay got that for free from a react-query cache the host had already
 * mounted; a published package cannot assume one — a query client is a host
 * decision, and requiring a particular one (or a particular version of one) is
 * the kind of dependency that keeps a package out of a host that made the other
 * choice. So the sharing is explicit and dependency-free: one subscribable
 * store, read through `useSyncExternalStore`.
 *
 * Optimistic on every write, with invalidate-on-error: the badge and the list
 * update instantly, and a failed write refetches the server truth rather than
 * leaving the screen asserting something the database does not say.
 */

export const PAGE_SIZE = 20;

/** The badge's poll while nothing is pushing to us. */
export const BADGE_POLL_MS = 60_000;

/**
 * The badge's interval while a realtime connection is live.
 *
 * Five minutes, not "never": this is the reconcile that catches an event the bus
 * dropped, and it costs one COUNT per open tab per five minutes. Deliberately
 * far slower than an operational screen's — a bell badge is ambient, and the
 * arrival that matters is pushed within milliseconds anyway. The poll does NOT
 * stop, which is the standing contract: a dropped event must cost latency and
 * never correctness.
 */
export const BADGE_RECONCILE_MS = 300_000;

export type InboxListStatus = 'idle' | 'pending' | 'ready' | 'error';

export interface InboxState {
  unread: number;
  items: InboxNotification[];
  status: InboxListStatus;
  /** A cursor means there is another page. */
  nextCursor: string | null;
  loadingMore: boolean;
}

export interface InboxStore {
  getState(): InboxState;
  subscribe(listener: () => void): () => void;
  /** Load the first page (idempotent while one is in flight). */
  open(): void;
  /** Refetch the badge count. */
  refreshBadge(): void;
  /** Refetch both — what a realtime hint or a failed write triggers. */
  invalidate(): void;
  loadMore(): void;
  markRead(ids: readonly string[]): void;
  markAllRead(): void;
  remove(id: string): void;
}

const EMPTY: InboxState = {
  unread: 0,
  items: [],
  status: 'idle',
  nextCursor: null,
  loadingMore: false,
};

/** The mutable cell the functions below share, so each one stays small. */
interface Cell {
  state: InboxState;
  listeners: Set<() => void>;
  /** Fences a stale reload: a newer one must always win. */
  request: number;
}

function patch(cell: Cell, next: Partial<InboxState>): void {
  cell.state = { ...cell.state, ...next };
  for (const listener of cell.listeners) listener();
}

/** Refetch the badge count. The number is always one the server just gave us. */
function refreshBadge(cell: Cell, api: NotificationsApiClient): void {
  void api
    .unreadCount()
    .then((unread) => patch(cell, { unread }))
    .catch(() => undefined);
}

/**
 * Reload page one, discarding whatever the optimistic path had produced.
 * `request` fences it: a reload that started before a newer one must not land
 * after it and reinstate stale rows.
 */
function reloadList(cell: Cell, api: NotificationsApiClient): void {
  const token = (cell.request += 1);
  patch(cell, { status: cell.state.items.length > 0 ? cell.state.status : 'pending' });
  void api
    .listNotifications({ limit: PAGE_SIZE })
    .then((page) => {
      if (token !== cell.request) return;
      patch(cell, { items: page.items, nextCursor: page.nextCursor, status: 'ready' });
    })
    .catch(() => {
      if (token !== cell.request) return;
      patch(cell, { status: 'error' });
    });
}

function invalidate(cell: Cell, api: NotificationsApiClient): void {
  refreshBadge(cell, api);
  if (cell.state.status !== 'idle') reloadList(cell, api);
}

/** Apply an optimistic edit; on failure, take the server's word instead. */
function write(
  cell: Cell,
  api: NotificationsApiClient,
  apply: () => void,
  send: () => Promise<{ ok: boolean }>,
): void {
  apply();
  void send()
    .then((result) => {
      if (!result.ok) invalidate(cell, api);
    })
    .catch(() => invalidate(cell, api));
}

function bumpUnread(cell: Cell, delta: number): void {
  patch(cell, { unread: Math.max(0, cell.state.unread + delta) });
}

function loadMore(cell: Cell, api: NotificationsApiClient): void {
  const cursor = cell.state.nextCursor;
  if (!cursor || cell.state.loadingMore) return;
  patch(cell, { loadingMore: true });
  void api
    .listNotifications({ cursor, limit: PAGE_SIZE })
    .then((page) => {
      patch(cell, {
        items: [...cell.state.items, ...page.items],
        nextCursor: page.nextCursor,
        loadingMore: false,
      });
    })
    .catch(() => patch(cell, { loadingMore: false }));
}

function markRead(cell: Cell, api: NotificationsApiClient, ids: readonly string[]): void {
  const readAt = new Date().toISOString();
  let flipped = 0;
  const items = cell.state.items.map((item) => {
    if (!ids.includes(item.id) || item.readAt !== null) return item;
    flipped += 1;
    return { ...item, readAt };
  });
  if (flipped === 0) return;
  write(
    cell,
    api,
    () => {
      patch(cell, { items });
      bumpUnread(cell, -flipped);
    },
    () => api.markRead(ids),
  );
}

function remove(cell: Cell, api: NotificationsApiClient, id: string): void {
  const target = cell.state.items.find((item) => item.id === id);
  if (!target) return;
  const items = cell.state.items.filter((item) => item.id !== id);
  write(
    cell,
    api,
    () => {
      patch(cell, { items });
      if (target.readAt === null) bumpUnread(cell, -1);
    },
    () => api.remove([id]),
  );
}

export function createInboxStore(api: NotificationsApiClient): InboxStore {
  const cell: Cell = { state: EMPTY, listeners: new Set(), request: 0 };
  return {
    getState: () => cell.state,
    subscribe(listener) {
      cell.listeners.add(listener);
      return () => cell.listeners.delete(listener);
    },
    open() {
      if (cell.state.status === 'idle') reloadList(cell, api);
    },
    refreshBadge: () => refreshBadge(cell, api),
    invalidate: () => invalidate(cell, api),
    loadMore: () => loadMore(cell, api),
    markRead: (ids) => markRead(cell, api, ids),
    markAllRead() {
      const readAt = new Date().toISOString();
      const items = cell.state.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt }));
      write(
        cell,
        api,
        () => patch(cell, { items, unread: 0 }),
        () => api.markAllRead(),
      );
    },
    remove: (id) => remove(cell, api, id),
  };
}
