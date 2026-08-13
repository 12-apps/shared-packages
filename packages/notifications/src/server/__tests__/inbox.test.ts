import { beforeEach, describe, expect, it } from 'vitest';

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

let db: MemoryDb;
let api: ApiNotifications;

beforeEach(() => {
  db = createMemoryDb();
  api = createApiNotifications({
    db: () => Promise.resolve(db),
    contacts: memoryContacts({
      u1: { email: 'buyer@example.com', phone: null },
      u2: { email: 'other@example.com', phone: null },
    }),
    generators: [ORDER_PAID as never],
    logger: { info: () => undefined, error: () => undefined },
  });
});

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
