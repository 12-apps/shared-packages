/* eslint-disable test-flakiness/no-test-isolation --
   `db` and `app` ARE rebuilt in `beforeEach`, which is the isolation this rule
   asks for; it flags the module-scoped binding they are assigned to, which is
   how a Hono app has to be shared between a builder and the cases. */
import { beforeEach, describe, expect, it } from 'vitest';

import { CLINIC_MESSAGES } from '../../__tests__/host-copy';
import { Hono } from 'hono';

import { notificationsRouter } from '../../hono';

import { createMemoryDb, memoryContacts, type MemoryDb } from './memory-db';

/**
 * The Hono adapter: the 401 that runs before any handler, the `{ data }`
 * envelope on the wire, and the mount order a host inherits.
 */

const ORDER_PAID = {
  type: 'order.paid',
  category: 'orders',
  generate: () => ({ title: 'Pagamento confirmado', body: 'Pedido pago.' }),
};

let db: MemoryDb;
let app: Hono;

beforeEach(() => {
  db = createMemoryDb();
  const notifications = notificationsRouter({
    categories: ['orders', 'payments', 'stock', 'system'],
    messages: CLINIC_MESSAGES,
    db: () => Promise.resolve(db),
    contacts: memoryContacts({ u1: { email: 'buyer@example.com', phone: null } }),
    generators: [ORDER_PAID as never],
    transports: [{ channel: 'EMAIL', linkLabel: 'Ver detalhes', driver: 'log' }],
    logger: { info: () => undefined, error: () => undefined },
    // The host's whole authorization seam: a header stands in for a session.
    resolveActor: (c) => {
      const userId = c.req.header('x-user');
      return userId ? { userId } : null;
    },
  });
  app = new Hono();
  app.route('/api/account', notifications.router);
});

const signedIn = { 'x-user': 'u1', 'content-type': 'application/json' };

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('authentication', () => {
  it('401s an unauthenticated caller before any handler runs', async () => {
    const response = await app.request('/api/account/notifications');
    expect(response.status).toBe(401);
    expect((await json<{ error: string }>(response)).error).toBe(CLINIC_MESSAGES.unauthenticated);
  });

  it('scopes every read to the signed-in user', async () => {
    await app.request('/api/account/notifications', { headers: signedIn });
    const response = await app.request('/api/account/notifications', {
      headers: { 'x-user': 'someone-else' },
    });
    expect(response.status).toBe(200);
    expect((await json<{ data: { items: unknown[] } }>(response)).data.items).toEqual([]);
  });
});

describe('the wire', () => {
  it('serves the literal /notifications/unread-count, not the list route', async () => {
    const response = await app.request('/api/account/notifications/unread-count', {
      headers: signedIn,
    });
    expect(response.status).toBe(200);
    expect((await json<{ data: { count: number } }>(response)).data).toEqual({ count: 0 });
  });

  it('round-trips an inbox write through the real HTTP surface', async () => {
    const created = await app.request('/api/account/notifications', { headers: signedIn });
    expect(created.status).toBe(200);

    const marked = await app.request('/api/account/notifications/mark-read', {
      method: 'POST',
      headers: signedIn,
      body: JSON.stringify({ all: true }),
    });
    expect(marked.status).toBe(200);
    expect((await json<{ data: { updated: number } }>(marked)).data.updated).toBe(0);
  });

  it('answers 400 with the pt-BR sentence, unwrapped, for a malformed body', async () => {
    const response = await app.request('/api/account/notifications/delete', {
      method: 'POST',
      headers: signedIn,
      body: 'not json',
    });
    expect(response.status).toBe(400);
    const body = await json<{ error?: string; data?: unknown }>(response);
    expect(body.error).toBe(CLINIC_MESSAGES.invalidBody);
    // A denial is NOT wrapped — the `{ data }` envelope is success only.
    expect(body.data).toBeUndefined();
  });

  it('reads the DELETE body, which is where the push endpoint travels', async () => {
    await app.request('/api/account/push-subscriptions', {
      method: 'POST',
      headers: signedIn,
      body: JSON.stringify({
        endpoint: 'https://push.example.com/x',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    });
    const response = await app.request('/api/account/push-subscriptions', {
      method: 'DELETE',
      headers: signedIn,
      body: JSON.stringify({ endpoint: 'https://push.example.com/x' }),
    });
    expect(response.status).toBe(200);
    expect((await json<{ data: { count: number } }>(response)).data.count).toBe(0);
  });

  it('refuses to parse a body the caller did not declare as JSON', async () => {
    // The three types a cross-site `fetch` or a plain `<form>` can send with NO
    // preflight. Parsing regardless of content-type is what lets such a request
    // reach a handler at all; refusing them makes the browser demand a preflight
    // first, and then refuse it. A speed bump, not the defence — ADOPTING rule 13
    // names that. The price is nil: every client of this surface sends JSON.
    for (const contentType of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=x',
    ]) {
      const response = await app.request('/api/account/push-subscriptions', {
        method: 'POST',
        headers: { 'x-user': 'u1', 'content-type': contentType },
        body: JSON.stringify({
          endpoint: 'https://push.attacker.example/x',
          keys: { p256dh: 'p', auth: 'a' },
        }),
      });
      expect(response.status).toBe(400);
    }
    expect(db.rows.subscriptions).toEqual([]);

    // …and the charset-bearing form every real client sends still works.
    const ok = await app.request('/api/account/push-subscriptions', {
      method: 'POST',
      headers: { 'x-user': 'u1', 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/z',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    });
    expect(ok.status).toBe(200);
    expect(db.rows.subscriptions).toHaveLength(1);
  });

  it('passes the user-agent through as the device hint', async () => {
    await app.request('/api/account/push-subscriptions', {
      method: 'POST',
      headers: { ...signedIn, 'user-agent': 'Firefox/1' },
      body: JSON.stringify({
        endpoint: 'https://push.example.com/y',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    });
    expect(db.rows.subscriptions[0]?.userAgent).toBe('Firefox/1');
  });
});
