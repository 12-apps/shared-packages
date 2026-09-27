import { beforeEach, describe, expect, it } from 'vitest';

import { CLINIC_MESSAGES } from '../../__tests__/host-copy';

import type { NotificationsActor } from '../context';
import { createApiNotifications, type ApiNotifications } from '../create-api-notifications';

import { createMemoryDb, memoryContacts, type MemoryDb } from './memory-db';

/**
 * One person, two SIDES of the same business.
 *
 * A shopper who also works at a store holds both a customer app and a staff
 * app, and each must show — and receive — only its own side: a "novo pedido"
 * alert does not belong in the app a customer opens to follow their order, and
 * "seu pedido está pronto" does not belong in the one a garçom works from.
 *
 * The side is the HOST's vocabulary, resolved per type by `sideOf`. These
 * suites pin what a side scope removes, what it must never remove (the
 * unclassified rows), and that a host which never classifies sees no change.
 */

const USER = 'u1';
const STORE_A = 'client-a';

/** `sideOf` for these suites: one customer type, one staff type, one unclassified. */
const SIDES: Record<string, string> = { 'order.ready': 'customer', 'order.new': 'staff' };

function generator(type: string, category: string, title: string) {
  return {
    type,
    category,
    generate: (payload: { code: string }) => ({ title, body: `${title} ${payload.code}` }),
  };
}

const GENERATORS = [
  generator('order.ready', 'orders', 'Seu pedido está pronto'),
  generator('order.new', 'orders', 'Novo pedido'),
  generator('account.notice', 'system', 'Aviso da conta'),
];

let db: MemoryDb;
let api: ApiNotifications;

function build(sideOf?: (type: string) => string | null): ApiNotifications {
  return createApiNotifications({
    categories: ['orders', 'system'],
    messages: CLINIC_MESSAGES,
    db: () => Promise.resolve(db),
    contacts: memoryContacts({ u1: { email: 'buyer@example.com', phone: null } }),
    generators: GENERATORS as never,
    logger: { info: () => undefined, error: () => undefined },
    ...(sideOf ? { sideOf } : {}),
  });
}

beforeEach(() => {
  db = createMemoryDb();
  api = build((type) => SIDES[type] ?? null);
});

async function emit(type: string, code: string, clientId?: string): Promise<void> {
  await api.notify({
    type,
    recipient: clientId === undefined ? { userId: USER } : { userId: USER, clientId },
    payload: { code },
  });
}

/** One of each: a customer row, a staff row, and an unclassified one. */
async function seedSides(): Promise<void> {
  await emit('order.ready', 'C');
  await emit('order.new', 'S');
  await emit('account.notice', 'N');
}

function bodies(items: readonly { body: string }[]): string[] {
  return items.map((item) => item.body).sort();
}

describe('the side a notification is written with', () => {
  it('stamps each row with the side its type resolves to', async () => {
    await seedSides();

    const sides = db.rows.notifications.map((row) => [row.type, row.side]).sort();
    expect(sides).toEqual([
      ['account.notice', null],
      ['order.new', 'staff'],
      ['order.ready', 'customer'],
    ]);
  });

  it('leaves every row unclassified when the host passes no resolver', async () => {
    const unclassified = build();
    for (const type of ['order.ready', 'order.new', 'account.notice']) {
      await unclassified.notify({ type, recipient: { userId: USER }, payload: { code: 'X' } });
    }

    expect(db.rows.notifications.map((row) => row.side)).toEqual([null, null, null]);
  });

  it('still writes the row, unclassified, when the resolver throws', async () => {
    // A notification that reaches one app too many is recoverable; one that
    // was never written is not.
    const throwing = build(() => {
      throw new Error('boom');
    });
    await throwing.notify({ type: 'order.new', recipient: { userId: USER }, payload: { code: 'S' } });

    expect(db.rows.notifications).toHaveLength(1);
    expect(db.rows.notifications[0]?.side).toBeNull();
  });
});

describe('the inbox, read as one side', () => {
  it('lists that side and the unclassified rows, never the other side', async () => {
    await seedSides();

    const customer = await api.inbox.list(USER, {}, undefined, 'customer');
    const staff = await api.inbox.list(USER, {}, undefined, 'staff');

    expect(bodies(customer.items)).toEqual(['Aviso da conta N', 'Seu pedido está pronto C']);
    expect(bodies(staff.items)).toEqual(['Aviso da conta N', 'Novo pedido S']);
  });

  it('answers the unread COUNT the same way the list does', async () => {
    await seedSides();

    await expect(api.inbox.unreadCount(USER, undefined, 'customer')).resolves.toBe(2);
    await expect(api.inbox.unreadCount(USER, undefined, 'staff')).resolves.toBe(2);
  });

  it('spans every side when no side is named', async () => {
    // Every adopter before this change, and every surface that serves both.
    await seedSides();

    const page = await api.inbox.list(USER, {});

    expect(page.items).toHaveLength(3);
    await expect(api.inbox.unreadCount(USER)).resolves.toBe(3);
  });

  it('holds the store scope and the side scope at once', async () => {
    // Two narrowings AND-ed: a second `OR` on one object would overwrite the
    // first and silently drop one of them.
    await emit('order.ready', 'A', STORE_A);
    await emit('order.ready', 'B', 'client-b');
    await emit('order.new', 'SA', STORE_A);

    const page = await api.inbox.list(USER, {}, STORE_A, 'customer');

    expect(bodies(page.items)).toEqual(['Seu pedido está pronto A']);
  });

  it('leaves the other side unread when “mark all” is pressed in one app', async () => {
    await seedSides();

    await api.inbox.markAllRead(USER, undefined, 'customer');

    const staffUnread = await api.inbox.list(USER, { filter: 'unread' }, undefined, 'staff');
    expect(bodies(staffUnread.items)).toEqual(['Novo pedido S']);
  });
});

describe('web push, across a person’s customer and staff apps', () => {
  async function subscribe(...subs: { id: string; side: string | null }[]): Promise<void> {
    for (const sub of subs) {
      await api.pushSubscriptions.save(USER, {
        endpoint: `https://push.example.com/${sub.id}`,
        keys: { p256dh: 'p', auth: 'a' },
        side: sub.side,
      });
    }
  }

  async function reachedBy(side: string | null): Promise<string[]> {
    const rows = await api.pushSubscriptions.list(USER, null, side);
    return rows.map((row) => row.endpoint.split('/').pop() ?? '').sort();
  }

  it('sends each side to its own app and to an app that serves both', async () => {
    await subscribe(
      { id: 's-customer', side: 'customer' },
      { id: 's-staff', side: 'staff' },
      { id: 's-both', side: null },
    );

    await expect(reachedBy('customer')).resolves.toEqual(['s-both', 's-customer']);
    await expect(reachedBy('staff')).resolves.toEqual(['s-both', 's-staff']);
  });

  it('sends an unclassified notification to every app', async () => {
    await subscribe({ id: 's-customer', side: 'customer' }, { id: 's-staff', side: 'staff' });

    await expect(reachedBy(null)).resolves.toEqual(['s-customer', 's-staff']);
  });

  it('counts only what a side can reach, so no delivery is enqueued for nothing', async () => {
    await subscribe({ id: 's-customer', side: 'customer' });

    await expect(api.pushSubscriptions.count(USER, null, 'staff')).resolves.toBe(0);
    await expect(api.pushSubscriptions.count(USER, null, 'customer')).resolves.toBe(1);
  });

  it('holds the store rule and the side rule at once', async () => {
    await api.pushSubscriptions.save(USER, {
      endpoint: 'https://push.example.com/s-b-customer',
      keys: { p256dh: 'p', auth: 'a' },
      clientId: 'client-b',
      side: 'customer',
    });
    await api.pushSubscriptions.save(USER, {
      endpoint: 'https://push.example.com/s-a-staff',
      keys: { p256dh: 'p', auth: 'a' },
      clientId: STORE_A,
      side: 'staff',
    });

    const rows = await api.pushSubscriptions.list(USER, STORE_A, 'customer');

    expect(rows).toEqual([]);
  });
});

describe('the subscription an app registers', () => {
  async function register(actor: Partial<NotificationsActor>): Promise<void> {
    const route = api.routes.find(
      (entry) => entry.method === 'POST' && entry.path === '/push-subscriptions',
    );
    if (!route) throw new Error('no POST /push-subscriptions');
    const response = await route.handle({
      actor: { userId: USER, ...actor },
      params: {},
      query: {},
      body: { endpoint: 'https://push.example.com/s1', keys: { p256dh: 'p', auth: 'a' } },
    });
    expect(response.status).toBe(200);
  }

  function storedSide(): string | null | undefined {
    return db.rows.subscriptions[0]?.side;
  }

  it('is stamped with the side the actor reads as', async () => {
    await register({ scopeSide: 'customer' });

    expect(storedSide()).toBe('customer');
  });

  it('is stamped with NO side when the host says every side reaches it', async () => {
    // The transition a host needs while one side has no app of its own yet.
    await register({ scopeSide: 'customer', pushSide: null });

    expect(storedSide()).toBeNull();
  });

  it('takes an explicit push side over the reading side', async () => {
    await register({ scopeSide: 'customer', pushSide: 'staff' });

    expect(storedSide()).toBe('staff');
  });

  it('is stamped with no side when the actor names none', async () => {
    await register({});

    expect(storedSide()).toBeNull();
  });
});
