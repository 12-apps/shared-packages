import { beforeEach, describe, expect, it } from 'vitest';

import { CLINIC_MESSAGES } from '../../__tests__/host-copy';

import { createApiNotifications, type ApiNotifications } from '../create-api-notifications';

import { createMemoryDb, memoryContacts, type MemoryDb } from './memory-db';

/**
 * One person, several installed apps.
 *
 * A multi-tenant host serves each store on its own origin and each origin
 * installs as its own PWA, so a reader inside store A's app must be answered
 * about store A — and about themselves. These suites pin both halves: what a
 * scope removes, and what it must never remove.
 *
 * Every case here fails against the unscoped implementation these replaced,
 * except the two that exist to prove the UNSCOPED answer is untouched — a host
 * with one origin passes no scope and must see exactly what it saw before.
 */

const STORE_A = 'client-a';
const STORE_B = 'client-b';
const USER = 'u1';

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
    categories: ['orders', 'system'],
    messages: CLINIC_MESSAGES,
    db: () => Promise.resolve(db),
    contacts: memoryContacts({ u1: { email: 'buyer@example.com', phone: null } }),
    generators: [ORDER_PAID as never],
    logger: { info: () => undefined, error: () => undefined },
  });
});

/** One inbox row at a store, or platform-wide when `clientId` is omitted. */
async function emit(code: string, clientId?: string): Promise<void> {
  await api.notify({
    type: 'order.paid',
    recipient: clientId === undefined ? { userId: USER } : { userId: USER, clientId },
    payload: { code },
  });
}

/** The three rows every case below starts from: one per store, one platform. */
async function seedThree(): Promise<void> {
  await emit('A', STORE_A);
  await emit('B', STORE_B);
  await emit('PLAT');
}

function bodies(items: readonly { body: string }[]): string[] {
  return items.map((item) => item.body).sort();
}

describe('the inbox, read from one store’s origin', () => {
  it('lists that store’s rows and the platform’s, never a neighbour’s', async () => {
    await seedThree();

    const page = await api.inbox.list(USER, {}, STORE_A);

    expect(bodies(page.items)).toEqual(['Pedido A pago.', 'Pedido PLAT pago.']);
  });

  it('keeps the platform-wide row on EVERY scope', async () => {
    // A password reset or a security notice is about the person, not about a
    // store. Hiding it inside the only app a customer opens would be a worse
    // failure than the leak this fixes.
    await seedThree();

    const fromB = await api.inbox.list(USER, {}, STORE_B);

    expect(bodies(fromB.items)).toEqual(['Pedido B pago.', 'Pedido PLAT pago.']);
  });

  it('answers the unread COUNT the same way the list does', async () => {
    // Two reads, two `where`s: scoping one and not the other is a badge saying
    // 3 over a list of 2, which is the defect a single scope argument prevents.
    await seedThree();

    await expect(api.inbox.unreadCount(USER, STORE_A)).resolves.toBe(2);
    await expect(api.inbox.unreadCount(USER, STORE_B)).resolves.toBe(2);
  });

  it('spans every store when no scope is named', async () => {
    // The platform host, and any adopter with a single origin. This is the
    // behaviour that existed before the scope, and it has to survive unchanged.
    await seedThree();

    const page = await api.inbox.list(USER, {});

    expect(bodies(page.items)).toEqual([
      'Pedido A pago.',
      'Pedido B pago.',
      'Pedido PLAT pago.',
    ]);
    await expect(api.inbox.unreadCount(USER)).resolves.toBe(3);
  });

  it('answers only the platform rows for a store the reader has nothing at', async () => {
    await emit('A', STORE_A);
    await emit('PLAT');

    const page = await api.inbox.list(USER, {}, STORE_B);

    expect(bodies(page.items)).toEqual(['Pedido PLAT pago.']);
  });

  it('holds the scope on page TWO, not just the first', async () => {
    // The regression the composition exists to prevent: the page boundary and
    // the store scope are two DISJUNCTIONS, and merging them into one `OR` key
    // drops whichever is written second. The anchor only matters from here on,
    // so a single-page assertion would never notice.
    for (let index = 0; index < 4; index += 1) await emit(`A${index}`, STORE_A);
    for (let index = 0; index < 4; index += 1) await emit(`B${index}`, STORE_B);

    const first = await api.inbox.list(USER, { limit: 2 }, STORE_A);
    expect(first.nextCursor).not.toBeNull();

    const second = await api.inbox.list(USER, { limit: 2, cursor: first.nextCursor ?? '' }, STORE_A);

    expect(second.items.every((item) => item.body.includes('Pedido A'))).toBe(true);
  });
});

describe('“mark all as read”, pressed inside one store’s app', () => {
  it('leaves the other store’s rows unread', async () => {
    // A cross-store WRITE, and strictly worse than the read leak: unscoped,
    // clearing the bell in store A's app clears store B's everywhere.
    await seedThree();

    await api.inbox.markAllRead(USER, STORE_A);

    await expect(api.inbox.unreadCount(USER, STORE_B)).resolves.toBe(1);
    await expect(api.inbox.unreadCount(USER)).resolves.toBe(1);
  });

  it('does clear the platform-wide rows, which follows from the scope rule', async () => {
    // Stated rather than discovered: those rows are one PERSON's, not one
    // store's, so every origin shows them and every origin may clear them.
    await seedThree();

    await api.inbox.markAllRead(USER, STORE_A);

    const fromB = await api.inbox.list(USER, { filter: 'unread' }, STORE_B);
    expect(bodies(fromB.items)).toEqual(['Pedido B pago.']);
  });

  it('clears everything when no scope is named', async () => {
    await seedThree();

    await api.inbox.markAllRead(USER);

    await expect(api.inbox.unreadCount(USER)).resolves.toBe(0);
  });
});

describe('web push, across a person’s installed apps', () => {
  /**
   * The rule under test, as data: which origin a subscription was registered
   * on, and which notification tenant is being sent.
   */
  const PLATFORM_SUB = { id: 's-plat', clientId: null };
  const STORE_A_SUB = { id: 's-a', clientId: STORE_A };
  const STORE_B_SUB = { id: 's-b', clientId: STORE_B };

  /**
   * Register each browser through the REAL write path, which is also what
   * stamps the origin — so these cases exercise `save` and the read rule
   * together rather than trusting a hand-placed row.
   */
  async function subscribe(...subs: { id: string; clientId: string | null }[]): Promise<void> {
    for (const sub of subs) {
      await api.pushSubscriptions.save(USER, {
        endpoint: `https://push.example.com/${sub.id}`,
        keys: { p256dh: 'p', auth: 'a' },
        clientId: sub.clientId,
      });
    }
  }

  /** The endpoints a notification reaches, named by their origin for readability. */
  function endpointsOf(rows: readonly { endpoint: string }[]): string[] {
    return rows.map((row) => row.endpoint.split('/').pop() ?? '').sort();
  }

  /** Who a notification for `clientId` actually reaches. */
  async function reachedBy(clientId: string | null): Promise<string[]> {
    return endpointsOf(await api.pushSubscriptions.list(USER, clientId));
  }

  it('sends a store’s notification to that store’s app and the platform, never a neighbour’s', async () => {
    await subscribe(PLATFORM_SUB, STORE_A_SUB, STORE_B_SUB);

    await expect(reachedBy(STORE_A)).resolves.toEqual(['s-a', 's-plat']);
    await expect(reachedBy(STORE_B)).resolves.toEqual(['s-b', 's-plat']);
  });

  it('sends a PLATFORM notification to every app the person installed', async () => {
    // Account security, a password reset, a consent change — about the person.
    await subscribe(PLATFORM_SUB, STORE_A_SUB, STORE_B_SUB);

    await expect(reachedBy(null)).resolves.toEqual(['s-a', 's-b', 's-plat']);
  });

  it('reaches a third store’s notification through the PLATFORM subscription only', async () => {
    // The customer installed store A and never store C. The notification still
    // arrives — on the marketplace origin — and through neither store's app.
    await subscribe(PLATFORM_SUB, STORE_A_SUB);

    await expect(reachedBy('client-c')).resolves.toEqual(['s-plat']);
  });

  it('reaches NOTHING rather than a neighbour when there is no platform subscription', async () => {
    // The direction that must never soften: with only store A installed, a
    // store-C notification has nowhere to go. It is not delivered to store A's
    // app as a fallback — the inbox row and e-mail still carry it.
    await subscribe(STORE_A_SUB);

    await expect(reachedBy('client-c')).resolves.toEqual([]);
  });

  it('counts only what a notification can REACH, so no delivery row is enqueued for nothing', async () => {
    // `supports()` gates on this count. Left unscoped it would answer true, the
    // router would enqueue a WEB_PUSH delivery, `send` would find an empty list
    // and throw, and the sweep would burn every attempt before writing DEAD — a
    // FAILED row for a notification that was never undeliverable, only out of
    // scope. This is the assertion that keeps that from coming back.
    await subscribe(STORE_A_SUB);

    await expect(api.pushSubscriptions.count(USER, 'client-c')).resolves.toBe(0);
    await expect(api.pushSubscriptions.count(USER, STORE_A)).resolves.toBe(1);
  });

  it('counts every device for the SETTINGS screen, which asks about the person', async () => {
    // The unscoped caller: "you have 3 devices" is a fact about the account and
    // must not shrink because the screen happens to be open on a store origin.
    await subscribe(PLATFORM_SUB, STORE_A_SUB, STORE_B_SUB);

    await expect(api.pushSubscriptions.count(USER)).resolves.toBe(3);
  });

  it('stamps a new subscription with the origin the HOST resolved', async () => {
    await api.pushSubscriptions.save(USER, {
      endpoint: 'https://push.example.com/new',
      keys: { p256dh: 'p', auth: 'a' },
      clientId: STORE_A,
    });

    await expect(reachedBy(STORE_A)).resolves.toHaveLength(1);
    await expect(reachedBy(STORE_B)).resolves.toEqual([]);
  });

  it('re-stamps the scope when the same browser subscribes from another origin', async () => {
    // One browser profile keeps ONE endpoint, so moving between a store's app
    // and the platform corrects the row rather than duplicating it.
    const endpoint = 'https://push.example.com/roamer';
    await api.pushSubscriptions.save(USER, {
      endpoint,
      keys: { p256dh: 'p', auth: 'a' },
      clientId: STORE_A,
    });
    await api.pushSubscriptions.save(USER, {
      endpoint,
      keys: { p256dh: 'p', auth: 'a' },
      clientId: null,
    });

    // Now platform-scoped: it receives everything, including store B's.
    await expect(reachedBy(STORE_B)).resolves.toHaveLength(1);
    await expect(api.pushSubscriptions.count(USER)).resolves.toBe(1);
  });

  it('treats a subscription saved with no origin as the platform’s', async () => {
    // What every pre-existing row reads as, with no backfill — the property
    // that makes this a minor release rather than a breaking one.
    await api.pushSubscriptions.save(USER, {
      endpoint: 'https://push.example.com/legacy',
      keys: { p256dh: 'p', auth: 'a' },
    });

    await expect(reachedBy(STORE_A)).resolves.toHaveLength(1);
    await expect(reachedBy(STORE_B)).resolves.toHaveLength(1);
  });
});
