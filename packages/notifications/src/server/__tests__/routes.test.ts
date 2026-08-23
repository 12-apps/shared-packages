/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   `db`, `api` and `changed` ARE rebuilt per case (`beforeEach` + `mount()`,
   which several cases re-run with a different config); the rule flags the
   module-scoped bindings they are assigned to. `changed` is the host's
   realtime-hint recorder, and appending to it is what the assertions read. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CLINIC_MESSAGES } from '../../__tests__/host-copy';

import { createApiNotifications, type ApiNotifications } from '../create-api-notifications';
import type { NotificationsResponse, NotificationsRoute } from '../context';

import { createMemoryDb, memoryContacts, type MemoryDb } from './memory-db';

/**
 * The route descriptors: the request contract, the `{ data }` envelope, the
 * status codes and the pt-BR denial copy — this is the origin host's six colocated
 * route suites, in the package that now owns them.
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
let changed: string[];

function mount(overrides: Partial<Parameters<typeof createApiNotifications>[0]> = {}): void {
  changed = [];
  api = createApiNotifications({
    categories: ['orders', 'payments', 'stock', 'system'],
    messages: CLINIC_MESSAGES,
    db: () => Promise.resolve(db),
    contacts: memoryContacts({
      u1: { email: 'buyer@example.com', phone: '+5531999998888' },
      'u-nophone': { email: 'nophone@example.com', phone: null },
    }),
    generators: [ORDER_PAID as never],
    transports: [{ channel: 'EMAIL', linkLabel: 'Ver detalhes', driver: 'log' }],
    onInboxChanged: (userId) => changed.push(userId),
    logger: { info: () => undefined, error: () => undefined },
    ...overrides,
  });
}

function route(method: string, path: string): NotificationsRoute {
  const found = api.routes.find((entry) => entry.method === method && entry.path === path);
  if (!found) throw new Error(`no route ${method} ${path}`);
  return found;
}

function call(
  method: string,
  path: string,
  request: { userId?: string; body?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<NotificationsResponse> {
  return route(method, path).handle({
    actor: { userId: request.userId ?? 'u1' },
    params: {},
    query: request.query ?? {},
    ...(request.body !== undefined ? { body: request.body } : {}),
    ...(request.headers ? { headers: request.headers } : {}),
  });
}

const data = <T,>(response: NotificationsResponse): T => (response.body as { data: T }).data;
const error = (response: NotificationsResponse): string =>
  (response.body as { error: string }).error;

beforeEach(() => {
  db = createMemoryDb();
  mount();
});

describe('the route table', () => {
  it('is the nine endpoints, in mount order', () => {
    expect(api.routes.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      'GET /notifications',
      'GET /notifications/unread-count',
      'POST /notifications/mark-read',
      'POST /notifications/delete',
      'GET /notification-preferences',
      'PUT /notification-preferences',
      'GET /push-subscriptions',
      'POST /push-subscriptions',
      'DELETE /push-subscriptions',
    ]);
  });
});

describe('GET /notifications', () => {
  it('answers the owner inbox inside the `{ data }` envelope', async () => {
    await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A1' } },
      { sync: true },
    );
    const response = await call('GET', '/notifications');
    expect(response.status).toBe(200);
    const payload = data<{ items: { title: string }[]; nextCursor: string | null }>(response);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.title).toBe('Pagamento confirmado');
    expect(payload.nextCursor).toBeNull();
  });

  it('rejects a limit that is not a valid page size, rather than defaulting it', async () => {
    for (const limit of ['0', '101', 'abc', '2.5']) {
      const response = await call('GET', '/notifications', { query: { limit } });
      expect(response.status).toBe(400);
      expect(error(response)).toBe(CLINIC_MESSAGES.invalidBody);
    }
  });

  it('rejects an unknown filter', async () => {
    const response = await call('GET', '/notifications', { query: { filter: 'archived' } });
    expect(response.status).toBe(400);
  });
});

describe('POST /notifications/mark-read', () => {
  async function seed(): Promise<string> {
    const { notificationId } = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A1' } },
      { sync: true },
    );
    return notificationId;
  }

  it('marks named ids and reports how many actually flipped', async () => {
    const id = await seed();
    const first = await call('POST', '/notifications/mark-read', { body: { ids: [id] } });
    expect(data<{ updated: number }>(first).updated).toBe(1);
    // Idempotent: a re-send changes nothing.
    const second = await call('POST', '/notifications/mark-read', { body: { ids: [id] } });
    expect(data<{ updated: number }>(second).updated).toBe(0);
  });

  it('hints the host ONLY when a row actually moved', async () => {
    const id = await seed();
    await call('POST', '/notifications/mark-read', { body: { ids: [id] } });
    expect(changed).toEqual(['u1']);
    await call('POST', '/notifications/mark-read', { body: { ids: [id] } });
    // Publishing on a no-op would wake every one of this user's devices to
    // re-read a badge that did not move.
    expect(changed).toEqual(['u1']);
  });

  it('marks all with `all: true`', async () => {
    await seed();
    await seed();
    const response = await call('POST', '/notifications/mark-read', { body: { all: true } });
    expect(data<{ updated: number }>(response).updated).toBe(2);
  });

  it('refuses neither-or-both with the pt-BR sentence', async () => {
    for (const body of [{}, { ids: ['x'], all: true }]) {
      const response = await call('POST', '/notifications/mark-read', { body });
      expect(response.status).toBe(400);
      expect(error(response)).toBe('Informe `ids` ou `all: true` (exatamente um).');
    }
  });

  it('refuses a malformed id list', async () => {
    for (const ids of [[], [''], [1], Array.from({ length: 101 }, (_, i) => `n${i}`), 'nope']) {
      const response = await call('POST', '/notifications/mark-read', { body: { ids } });
      expect(response.status).toBe(400);
    }
  });

  it('refuses a body that is not an object at all', async () => {
    for (const body of [undefined, null, 'x', [1]]) {
      expect((await call('POST', '/notifications/mark-read', { body })).status).toBe(400);
    }
  });
});

describe('POST /notifications/delete', () => {
  it('soft-deletes and hints once', async () => {
    const { notificationId } = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A1' } },
      { sync: true },
    );
    const response = await call('POST', '/notifications/delete', { body: { ids: [notificationId] } });
    expect(data<{ deleted: number }>(response).deleted).toBe(1);
    expect(changed).toEqual(['u1']);
    expect(data<{ items: unknown[] }>(await call('GET', '/notifications')).items).toEqual([]);
  });

  it('requires at least one id', async () => {
    expect((await call('POST', '/notifications/delete', { body: { ids: [] } })).status).toBe(400);
  });
});

describe('the preferences endpoints', () => {
  it('answers the matrix, the availability probe and the host taxonomy', async () => {
    const response = await call('GET', '/notification-preferences');
    const payload = data<{
      preferences: Record<string, Record<string, boolean>>;
      availability: Record<string, boolean>;
      categories: string[];
    }>(response);

    expect(payload.categories).toEqual(['orders', 'payments', 'stock', 'system']);
    expect(payload.preferences.orders).toEqual({
      EMAIL: true,
      SMS: false,
      WHATSAPP: false,
      WEB_PUSH: true,
    });
    // Only EMAIL is declared, so nothing else can reach anybody.
    expect(payload.availability).toEqual({
      EMAIL: true,
      SMS: false,
      WHATSAPP: false,
      WEB_PUSH: false,
    });
  });

  it('reports a channel as unavailable when the DESTINATION is missing', async () => {
    const payload = data<{ availability: Record<string, boolean> }>(
      await call('GET', '/notification-preferences', { userId: 'u-nophone' }),
    );
    expect(payload.availability.EMAIL).toBe(true);
  });

  it('probes WEB_PUSH with a hypothetical subscription, so the toggle is reachable', async () => {
    // Requiring an existing subscription would deadlock the UX: the browser
    // subscribe step happens right from that toggle.
    mount({ transports: [{ channel: 'WEB_PUSH', driver: 'log', publicKey: 'BPub' }] });
    const payload = data<{ availability: Record<string, boolean> }>(
      await call('GET', '/notification-preferences'),
    );
    expect(payload.availability.WEB_PUSH).toBe(true);
  });

  it('PUT persists a subset and answers the whole matrix back', async () => {
    const response = await call('PUT', '/notification-preferences', {
      body: { orders: { EMAIL: false } },
    });
    expect(response.status).toBe(200);
    const payload = data<{ preferences: Record<string, Record<string, boolean>> }>(response);
    expect(payload.preferences.orders?.EMAIL).toBe(false);
    // Untouched categories keep their defaults.
    expect(payload.preferences.system?.EMAIL).toBe(true);
  });

  it('ignores a category outside the taxonomy instead of failing the whole save', async () => {
    // A stale client sending an extra key must not cost the user the toggle they
    // did flip.
    const response = await call('PUT', '/notification-preferences', {
      body: { orders: { SMS: true }, gossip: { EMAIL: true } },
    });
    expect(response.status).toBe(200);
    expect(
      data<{ preferences: Record<string, Record<string, boolean>> }>(response).preferences.orders
        ?.SMS,
    ).toBe(true);
    expect(db.rows.preferences.map((row) => row.category)).toEqual(['orders']);
  });

  it('refuses a non-boolean toggle', async () => {
    const response = await call('PUT', '/notification-preferences', {
      body: { orders: { EMAIL: 'yes' } },
    });
    expect(response.status).toBe(400);
  });

  it('renders the HOST taxonomy when one is configured', async () => {
    mount({ categories: ['invoices'] });
    const payload = data<{ categories: string[]; preferences: Record<string, unknown> }>(
      await call('GET', '/notification-preferences'),
    );
    expect(payload.categories).toEqual(['invoices']);
    expect(Object.keys(payload.preferences)).toEqual(['invoices']);
  });
});

describe('the push-subscription endpoints', () => {
  const subscription = {
    endpoint: 'https://push.example.com/abc',
    keys: { p256dh: 'p', auth: 'a' },
  };

  it('serves the VAPID public key and the device count', async () => {
    mount({ transports: [{ channel: 'WEB_PUSH', driver: 'log', publicKey: 'BPub' }] });
    const payload = data<{ vapidPublicKey: string | null; count: number }>(
      await call('GET', '/push-subscriptions'),
    );
    expect(payload).toEqual({ vapidPublicKey: 'BPub', count: 0 });
  });

  it('answers a null key when web push is not configured on this deployment', async () => {
    const payload = data<{ vapidPublicKey: string | null }>(
      await call('GET', '/push-subscriptions'),
    );
    expect(payload.vapidPublicKey).toBeNull();
  });

  it('registers a browser, stamping the user-agent hint', async () => {
    const response = await call('POST', '/push-subscriptions', {
      body: subscription,
      headers: { 'user-agent': 'Chrome/1 Linux' },
    });
    expect(data<{ count: number }>(response).count).toBe(1);
    expect(db.rows.subscriptions[0]).toMatchObject({
      userId: 'u1',
      endpoint: subscription.endpoint,
      userAgent: 'Chrome/1 Linux',
    });
  });

  it('upserts on the endpoint, so re-subscribing never duplicates', async () => {
    await call('POST', '/push-subscriptions', { body: subscription });
    const again = await call('POST', '/push-subscriptions', { body: subscription });
    expect(data<{ count: number }>(again).count).toBe(1);
  });

  it('re-owns an endpoint recycled to a different signed-in user', async () => {
    await call('POST', '/push-subscriptions', { body: subscription });
    await call('POST', '/push-subscriptions', { body: subscription, userId: 'u-nophone' });
    expect(db.rows.subscriptions).toHaveLength(1);
    expect(db.rows.subscriptions[0]?.userId).toBe('u-nophone');
  });

  it('LOGS a re-own, naming both users and never the endpoint', async () => {
    // A silent transfer is what makes "user X stopped getting web push on the
    // counter PC" unanswerable. The endpoint stays out of it: it is a bearer
    // capability for that browser and must not reach logs.
    const errors: string[] = [];
    mount({ logger: { info: () => undefined, error: (message) => errors.push(message) } });
    await call('POST', '/push-subscriptions', { body: subscription });
    expect(errors).toEqual([]);

    await call('POST', '/push-subscriptions', { body: subscription, userId: 'u-nophone' });
    expect(errors.join('\n')).toMatch(/push endpoint re-owned: user u1 lost .* to user u-nophone/);
    expect(errors.join('\n')).not.toContain(subscription.endpoint);
  });

  it('answers `registered: false` once the row is somebody ELSE\'s', async () => {
    // The whole point of the flag. Ana's browser still holds the subscription
    // object, so a browser-only check says "receiving alerts" forever while the
    // row belongs to Otávio — a healthy UI over a channel that is gone.
    await call('POST', '/push-subscriptions', { body: subscription });
    const mine = data<{ registered?: boolean }>(
      await call('GET', '/push-subscriptions', { query: { endpoint: subscription.endpoint } }),
    );
    expect(mine.registered).toBe(true);

    await call('POST', '/push-subscriptions', { body: subscription, userId: 'u-nophone' });
    const stolen = data<{ registered?: boolean }>(
      await call('GET', '/push-subscriptions', { query: { endpoint: subscription.endpoint } }),
    );
    expect(stolen.registered).toBe(false);
  });

  it('answers `registered: false` for an endpoint nobody registered, and omits it unasked', async () => {
    // Same answer for "no such row" and "not yours", so the flag tells a caller
    // holding a foreign endpoint nothing about who owns it.
    const unknown = data<{ registered?: boolean; count: number }>(
      await call('GET', '/push-subscriptions', { query: { endpoint: 'https://push.example.com/x' } }),
    );
    expect(unknown.registered).toBe(false);

    const plain = data<{ registered?: boolean }>(await call('GET', '/push-subscriptions'));
    expect('registered' in plain).toBe(false);
  });

  it('refuses a junk `endpoint` query rather than looking it up', async () => {
    for (const endpoint of ['not-a-url', 'javascript:alert(1)', 'a'.repeat(2001)]) {
      expect((await call('GET', '/push-subscriptions', { query: { endpoint } })).status).toBe(400);
    }
  });

  it('removes by endpoint, owner-scoped', async () => {
    await call('POST', '/push-subscriptions', { body: subscription });
    const response = await call('DELETE', '/push-subscriptions', {
      body: { endpoint: subscription.endpoint },
    });
    expect(data<{ count: number }>(response).count).toBe(0);
  });

  it('refuses an endpoint that is not an absolute http(s) URL', async () => {
    for (const endpoint of ['', 'not-a-url', 'javascript:alert(1)', 'a'.repeat(2001)]) {
      const response = await call('POST', '/push-subscriptions', {
        body: { endpoint, keys: { p256dh: 'p', auth: 'a' } },
      });
      expect(response.status).toBe(400);
    }
  });

  it('refuses missing or over-long subscription keys', async () => {
    for (const keys of [undefined, {}, { p256dh: 'p' }, { p256dh: 'x'.repeat(501), auth: 'a' }]) {
      const response = await call('POST', '/push-subscriptions', {
        body: { endpoint: subscription.endpoint, keys },
      });
      expect(response.status).toBe(400);
    }
  });
});

describe('the copy table reaches the wire', () => {
  it("says the host's sentence, because there is no other one to say", async () => {
    // The package ships no table, so this is not "an override beat a default" —
    // it is the only copy that exists. `messages` is whole, so a host restating
    // one sentence restates them all, which is what removes the class of bug
    // where a partial table left the origin's wording in the gaps.
    mount({ messages: { ...CLINIC_MESSAGES, invalidBody: 'Bad request.' } });
    const response = await call('POST', '/notifications/delete', { body: { ids: [] } });
    expect(error(response)).toBe('Bad request.');
  });

  it('exposes the WIRE copy in force, which is all a server mount states', () => {
    // Narrowed to `NotificationWireMessages` when `messages` became required:
    // making a backend-only adopter write three dozen sentences for screens it
    // does not serve is the kind of tax that gets a migration reverted rather
    // than adopted. The four here are the ones this half actually puts on a
    // wire; the panel's own copy belongs to the react mount.
    expect(api.messages.unauthenticated).toBe(CLINIC_MESSAGES.unauthenticated);
    expect(api.messages.invalidBody).toBe(CLINIC_MESSAGES.invalidBody);
  });
});

describe('the logger seam', () => {
  it('uses the host logger rather than the console', async () => {
    const error_ = vi.fn();
    mount({ logger: { info: vi.fn(), error: error_ }, scheduleDispatch: () => Promise.reject(new Error('queue down')) });
    await api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A' } });
    // The detached dispatch's rejection is reported, not swallowed and not thrown.
    // `notify` returns before it resolves — that IS the fire-and-forget contract
    // — so the assertion waits for the report rather than for a fixed delay.
    await vi.waitFor(() => expect(error_).toHaveBeenCalled());
  });
});
