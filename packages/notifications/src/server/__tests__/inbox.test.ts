import { beforeEach, describe, expect, it } from 'vitest';

import { CLINIC_MESSAGES } from '../../__tests__/host-copy';

import { createApiNotifications, type ApiNotifications } from '../create-api-notifications';

import { createMemoryDb, memoryContacts, type MemoryDb } from './memory-db';

/**
 * The notification-centre inbox: owner scoping, cursor paging, the unread
 * count, idempotent mark-read and the soft delete that keeps the delivery trail.
 */

const ORDER_PAID = {
  type: 'order.paid',
  category: 'orders',
  generate: (payload: { code: string }) => ({
    title: 'Pagamento confirmado',
    body: `Pedido ${payload.code} pago.`,
  }),
};

/** A generator that ties its row to an ongoing subject, the way a stage does. */
const ORDER_MOVED = {
  type: 'order.moved',
  category: 'orders',
  generate: (payload: { code: string; subject?: unknown }) => ({
    title: 'Seu pedido está pronto',
    body: `Pedido ${payload.code}.`,
    ...(payload.subject === undefined ? {} : { data: { liveSubject: payload.subject } }),
  }),
};

let db: MemoryDb;
let api: ApiNotifications;

beforeEach(() => {
  db = createMemoryDb();
  api = createApiNotifications({
    categories: ['orders', 'payments', 'stock', 'system'],
    messages: CLINIC_MESSAGES,
    db: () => Promise.resolve(db),
    contacts: memoryContacts({
      u1: { email: 'buyer@example.com', phone: null },
      u2: { email: 'other@example.com', phone: null },
    }),
    generators: [ORDER_PAID as never, ORDER_MOVED as never],
    logger: { info: () => undefined, error: () => undefined },
  });
});

/** One row about an ongoing subject. `subject` of `undefined` writes no key. */
async function seedLiveRow(userId: string, subject: unknown): Promise<string> {
  const { notificationId } = await api.notify(
    { type: 'order.moved', recipient: { userId }, payload: { code: 'P9', subject } },
    { sync: true },
  );
  return notificationId;
}

async function seedInbox(userId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const { notificationId } = await api.notify(
      { type: 'order.paid', recipient: { userId }, payload: { code: `P${index}` } },
      { sync: true },
    );
    ids.push(notificationId);
  }
  return ids;
}

describe('listing', () => {
  it("lists only the owner's non-deleted rows, newest first, cursor-paginated", async () => {
    const ids = await seedInbox('u1', 5);
    await seedInbox('u2', 1);

    const page1 = await api.inbox.list('u1', { limit: 3 });
    expect(page1.items).toHaveLength(3);
    expect(page1.items[0]?.body).toBe('Pedido P4 pago.');
    expect(page1.nextCursor).toBe(page1.items[2]?.id);

    const page2 = await api.inbox.list('u1', { limit: 3, cursor: page1.nextCursor as string });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    const seen = [...page1.items, ...page2.items].map((item) => item.id);
    expect(new Set(seen).size).toBe(5);
    expect(seen).toEqual(expect.arrayContaining(ids));
  });

  it('does not skip a row when the anchor was DELETED between the two pages', async () => {
    // The bottom visible row is the one carrying the delete button, so this is
    // the ordinary case, not an edge one. Under Prisma's positional cursor the
    // `skip: 1` is an OFFSET applied AFTER the `where` — once the anchor stops
    // matching `deletedAt: null`, that offset eats the first SURVIVING row, which
    // then never appears in the list while still counting toward the badge.
    const ids = await seedInbox('u1', 5);
    const page1 = await api.inbox.list('u1', { limit: 2 });
    const anchor = page1.nextCursor as string;
    expect(anchor).toBe(page1.items[1]?.id);

    expect(await api.inbox.softDelete('u1', [anchor])).toBe(1);

    const page2 = await api.inbox.list('u1', { limit: 2, cursor: anchor });
    const seen = [...page1.items, ...page2.items].map((item) => item.id);
    // Four distinct rows across the two pages, and the survivor immediately
    // below the deleted anchor is one of them.
    expect(new Set(seen).size).toBe(4);
    expect(seen).toContain(ids[2]);
  });

  it('answers an empty page for a cursor that is not the caller’s', async () => {
    await seedInbox('u1', 3);
    const [foreign] = await seedInbox('u2', 1);
    const page = await api.inbox.list('u1', { cursor: foreign as string });
    // Not page one: a foreign id names no position in this user's list, and
    // silently restarting would repeat rows the caller has already seen.
    expect(page).toEqual({ items: [], nextCursor: null });
    expect((await api.inbox.list('u1', { cursor: 'invented' })).items).toEqual([]);
  });

  it('clamps the page size instead of trusting the caller', async () => {
    await seedInbox('u1', 3);
    expect((await api.inbox.list('u1', { limit: 0 })).items).toHaveLength(1);
    expect((await api.inbox.list('u1', { limit: 1000 })).items).toHaveLength(3);
  });

  it('filters unread and keeps the count accurate through mark-read', async () => {
    const ids = await seedInbox('u1', 3);
    expect(await api.inbox.unreadCount('u1')).toBe(3);

    expect(await api.inbox.markRead('u1', [ids[0] as string])).toBe(1);
    expect(await api.inbox.unreadCount('u1')).toBe(2);
    expect((await api.inbox.list('u1', { filter: 'unread' })).items).toHaveLength(2);

    // Idempotent + owner-scoped: re-reading and foreign ids are no-ops.
    expect(await api.inbox.markRead('u1', [ids[0] as string, 'not-mine'])).toBe(0);

    expect(await api.inbox.markAllRead('u1')).toBe(2);
    expect(await api.inbox.unreadCount('u1')).toBe(0);
  });

  it("never marks another user's rows read", async () => {
    const [foreign] = await seedInbox('u2', 1);
    expect(await api.inbox.markRead('u1', [foreign as string])).toBe(0);
    expect(await api.inbox.unreadCount('u2')).toBe(1);
  });

  it('treats an empty id list as a no-op rather than "everything"', async () => {
    await seedInbox('u1', 2);
    expect(await api.inbox.markRead('u1', [])).toBe(0);
    expect(await api.inbox.softDelete('u1', [])).toBe(0);
    expect(await api.inbox.unreadCount('u1')).toBe(2);
  });
});

describe('soft delete', () => {
  it('removes rows from list + count forever, keeping the delivery history', async () => {
    api.transports.register({
      channel: 'EMAIL',
      supports: () => true,
      format: () => ({}),
      send: () => Promise.resolve(),
    });
    const ids = await seedInbox('u1', 2);
    const removed = ids[0] as string;

    expect(await api.inbox.softDelete('u1', [removed])).toBe(1);
    expect((await api.inbox.list('u1')).items.map((item) => item.id)).toEqual([ids[1]]);
    expect(await api.inbox.unreadCount('u1')).toBe(1);

    // Idempotent; a second delete of the same row is a no-op.
    expect(await api.inbox.softDelete('u1', [removed])).toBe(0);
    // Mark-read can never resurrect a deleted row.
    expect(await api.inbox.markRead('u1', [removed])).toBe(0);
    // The delivery audit trail under the deleted notification survives.
    expect(
      db.rows.deliveries.filter((row) => row.notificationId === removed).length,
    ).toBeGreaterThan(0);
  });
});

/**
 * The badge's second number: which of the unread rows are about something the
 * reader may already be watching happen.
 *
 * The count alone cannot say. A pedido that moves through four stages writes
 * four inbox rows AND is one live activity, and a bell that added them would
 * say `5` about one dinner. The server cannot do the subtraction — only the
 * client knows what is live right now — so it answers the breakdown and the
 * surface joins the two (`react/bell-badge.ts`).
 */
describe('the unread summary', () => {
  it('counts every unread row, and tallies the ones naming a live subject', async () => {
    await seedInbox('u1', 2);
    await seedLiveRow('u1', 'order:42');
    await seedLiveRow('u1', 'order:42');
    await seedLiveRow('u1', 'order:7');

    expect(await api.inbox.unreadSummary('u1')).toEqual({
      total: 5,
      // Counts and not a set: two unread stages of one pedido must subtract two,
      // or the bell keeps a number for news the reader has already been shown.
      byLiveSubject: { 'order:42': 2, 'order:7': 1 },
    });
  });

  it('leaves the tally empty when nothing names a subject', async () => {
    await seedInbox('u1', 3);
    expect(await api.inbox.unreadSummary('u1')).toEqual({ total: 3, byLiveSubject: {} });
  });

  it('ignores a `data` that does not NAME a subject', async () => {
    // `data` is stored verbatim, so anything can be in that key — and a number,
    // an empty string or an absent key all mean "this is an ordinary event".
    // Counted in `total` (they are unread rows); absent from the tally.
    await seedLiveRow('u1', 42);
    await seedLiveRow('u1', '');
    await seedLiveRow('u1', undefined);
    expect(await api.inbox.unreadSummary('u1')).toEqual({ total: 3, byLiveSubject: {} });
  });

  it('drops a row from the tally once it is read, deleted, or another user asks', async () => {
    const read = await seedLiveRow('u1', 'order:42');
    const removed = await seedLiveRow('u1', 'order:42');
    await seedLiveRow('u1', 'order:42');
    await seedLiveRow('u2', 'order:99');

    expect(await api.inbox.markRead('u1', [read])).toBe(1);
    expect(await api.inbox.softDelete('u1', [removed])).toBe(1);

    expect(await api.inbox.unreadSummary('u1')).toEqual({
      total: 1,
      byLiveSubject: { 'order:42': 1 },
    });
    // Owner-scoped like every other read here: u2's row is u2's alone.
    expect(await api.inbox.unreadSummary('u2')).toEqual({
      total: 1,
      byLiveSubject: { 'order:99': 1 },
    });
  });

  it('agrees with `unreadCount`, which is the number the badge still shows', async () => {
    await seedInbox('u1', 2);
    await seedLiveRow('u1', 'order:42');
    const summary = await api.inbox.unreadSummary('u1');
    expect(summary.total).toBe(await api.inbox.unreadCount('u1'));
  });
});
