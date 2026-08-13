import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UnknownNotificationRecipientError, UnknownNotificationTypeError } from '../../errors';
import type { NotificationChannel, NotificationTransport } from '../../types';
import { createApiNotifications, type ApiNotifications } from '../create-api-notifications';

import { createMemoryDb, memoryContacts, type MemoryDb } from './memory-db';

/**
 * The channel router: routing and fan-out, preference gating, the delivery
 * lifecycle, failure isolation and the retry sweep.
 *
 * This is future-pay's `tests/integration/notifications.test.ts` as a unit
 * suite — the same claims, against the in-memory seam. The database half of
 * those claims is re-run over a real Postgres in
 * `harness/backend/tests/notifications-pipeline.test.ts`.
 */

/** A controllable in-memory transport standing in for a real channel. */
function fakeTransport(
  channel: NotificationChannel,
  options: { supported?: boolean; fail?: boolean } = {},
): NotificationTransport<{ text: string }> & { sent: string[] } {
  const sent: string[] = [];
  return {
    channel,
    sent,
    supports: () => options.supported ?? true,
    format: (content) => ({ text: `${content.title}|${content.body}` }),
    send: (message) => {
      if (options.fail) return Promise.reject(new Error(`${channel} provider down`));
      sent.push(message.text);
      return Promise.resolve();
    },
  };
}

const ORDER_PAID = {
  type: 'order.paid',
  category: 'orders',
  generate: (payload: { code: string }) => ({
    title: 'Pagamento confirmado',
    body: `Pedido ${payload.code} pago.`,
    link: `/orders/${payload.code}`,
    data: { code: payload.code },
  }),
};

const silentLogger = { info: () => undefined, error: () => undefined };

let db: MemoryDb;

function mount(
  overrides: Partial<Parameters<typeof createApiNotifications>[0]> = {},
): ApiNotifications {
  return createApiNotifications({
    db: () => Promise.resolve(db),
    contacts: memoryContacts({
      u1: { email: 'buyer@example.com', phone: '+5531999998888' },
      u2: { email: 'other@example.com', phone: null },
    }),
    generators: [ORDER_PAID as never],
    logger: silentLogger,
    ...overrides,
  });
}

/** Register transports on a mount without going through the driver table. */
function withTransports(
  api: ApiNotifications,
  ...transports: NotificationTransport<{ text: string }>[]
): void {
  for (const transport of transports) api.transports.register(transport);
}

beforeEach(() => {
  db = createMemoryDb();
});

describe('notify — routing and fan-out', () => {
  it('throws for an unregistered type (caller bug, never swallowed)', async () => {
    await expect(
      mount().notify({ type: 'nope.event', recipient: { userId: 'u1' }, payload: {} }),
    ).rejects.toThrow(UnknownNotificationTypeError);
  });

  it('throws for a recipient the host cannot identify', async () => {
    await expect(
      mount().notify({ type: 'order.paid', recipient: { userId: 'ghost' }, payload: { code: 'A' } }),
    ).rejects.toThrow(UnknownNotificationRecipientError);
  });

  it('always writes the inbox record, even with zero channels declared', async () => {
    const api = mount();
    const result = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A1' } },
      { sync: true },
    );

    expect(result.channels).toEqual([]);
    expect(db.rows.notifications[0]).toMatchObject({
      id: result.notificationId,
      userId: 'u1',
      type: 'order.paid',
      category: 'orders',
      title: 'Pagamento confirmado',
      body: 'Pedido A1 pago.',
      link: '/orders/A1',
      readAt: null,
      deletedAt: null,
    });
    expect(db.rows.deliveries).toHaveLength(0);
  });

  it('fans out per default-enabled, supported channel and marks it SENT', async () => {
    const api = mount();
    const email = fakeTransport('EMAIL');
    const sms = fakeTransport('SMS'); // default prefs: SMS off → no row
    withTransports(api, email, sms);

    const result = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A2' } },
      { sync: true },
    );

    expect(result.channels).toEqual(['EMAIL']);
    expect(db.rows.deliveries).toHaveLength(1);
    expect(db.rows.deliveries[0]).toMatchObject({
      channel: 'EMAIL',
      status: 'SENT',
      error: null,
    });
    expect(db.rows.deliveries[0]?.sentAt).toBeInstanceOf(Date);
    expect(email.sent).toEqual(['Pagamento confirmado|Pedido A2 pago.']);
    expect(sms.sent).toEqual([]);
  });

  it('honours explicit preferences in both directions', async () => {
    const api = mount();
    const email = fakeTransport('EMAIL');
    const sms = fakeTransport('SMS');
    withTransports(api, email, sms);
    await api.preferences.save('u1', { orders: { EMAIL: false, SMS: true } });

    const result = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A3' } },
      { sync: true },
    );

    expect(result.channels).toEqual(['SMS']);
    expect(email.sent).toEqual([]);
    expect(sms.sent).toEqual(['Pagamento confirmado|Pedido A3 pago.']);
  });

  it('a partial preference save merges over existing choices, never back to defaults', async () => {
    const api = mount();
    await api.preferences.save('u1', { orders: { EMAIL: false } });
    await api.preferences.save('u1', { orders: { SMS: true } });

    const matrix = await api.preferences.get('u1');
    expect(matrix.orders).toEqual({
      EMAIL: false,
      SMS: true,
      WHATSAPP: false,
      WEB_PUSH: true,
    });
  });

  it('skips a channel whose transport does not support the recipient', async () => {
    const api = mount();
    withTransports(api, fakeTransport('EMAIL', { supported: false }));

    const result = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A4' } },
      { sync: true },
    );

    expect(result.channels).toEqual([]);
    expect(db.rows.deliveries).toHaveLength(0);
  });

  it('isolates failures: one FAILED row never blocks the others or the inbox', async () => {
    const api = mount();
    const push = fakeTransport('WEB_PUSH');
    withTransports(api, fakeTransport('EMAIL', { fail: true }), push);

    const result = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A5' } },
      { sync: true },
    );

    expect(result.channels).toEqual(['EMAIL', 'WEB_PUSH']);
    const byChannel = Object.fromEntries(db.rows.deliveries.map((row) => [row.channel, row]));
    expect(byChannel.EMAIL).toMatchObject({ status: 'FAILED', error: 'EMAIL provider down' });
    expect(byChannel.WEB_PUSH).toMatchObject({ status: 'SENT', error: null });
    expect(push.sent).toHaveLength(1);
    expect(await api.inbox.unreadCount('u1')).toBe(1);
  });

  it('stamps the tenant when the recipient carries one', async () => {
    const api = mount();
    await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1', clientId: 'c1' }, payload: { code: 'A6' } },
      { sync: true },
    );
    expect(db.rows.notifications[0]?.clientId).toBe('c1');
  });

  it('re-dispatches FAILED deliveries via the drain sweep (FAILED → SENT)', async () => {
    const api = mount();
    withTransports(api, fakeTransport('EMAIL', { fail: true }));
    await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A7' } },
      { sync: true },
    );
    expect(db.rows.deliveries[0]?.status).toBe('FAILED');

    // Provider recovers; age the row past the sweep cutoff and drain.
    withTransports(api, fakeTransport('EMAIL'));
    const row = db.rows.deliveries[0];
    // Age the row past the sweep cutoff. Relative to the row's OWN stamp rather
    // than to a fixed date, because the sweep compares against `Date.now()`.
    if (row) row.updatedAt = new Date(row.updatedAt.getTime() - 10 * 60_000);

    const { dispatched } = await api.drainPending(5 * 60_000);
    expect(dispatched).toBe(1);
    expect(db.rows.deliveries[0]?.status).toBe('SENT');
  });

  it('re-dispatch is idempotent: an already-SENT row is not sent twice', async () => {
    const api = mount();
    const email = fakeTransport('EMAIL');
    withTransports(api, email);
    const { notificationId } = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'A8' } },
      { sync: true },
    );

    await api.dispatchDeliveries(notificationId);
    expect(email.sent).toHaveLength(1);
  });
});

describe('the host seams around the router', () => {
  it('filters channels through the tenant plan gate, degrading rather than dropping', async () => {
    const api = mount({
      channelPolicy: (_clientId, channels) => channels.filter((channel) => channel !== 'EMAIL'),
    });
    withTransports(api, fakeTransport('EMAIL'), fakeTransport('WEB_PUSH'));

    const result = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1', clientId: 'c1' }, payload: { code: 'B1' } },
      { sync: true },
    );

    expect(result.channels).toEqual(['WEB_PUSH']);
    // The notification still exists — a revoked transport costs a channel, not
    // the notification.
    expect(db.rows.notifications).toHaveLength(1);
  });

  it('never policy-filters a PLATFORM emit (no tenant)', async () => {
    const policy = vi.fn(() => Promise.resolve([] as NotificationChannel[]));
    const api = mount({ channelPolicy: policy });
    withTransports(api, fakeTransport('EMAIL'));

    const result = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'B2' } },
      { sync: true },
    );

    expect(policy).not.toHaveBeenCalled();
    expect(result.channels).toEqual(['EMAIL']);
  });

  it('fails OPEN when the policy throws — an extra notification beats none', async () => {
    const api = mount({
      channelPolicy: () => {
        throw new Error('entitlements unavailable');
      },
    });
    withTransports(api, fakeTransport('EMAIL'));

    const result = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1', clientId: 'c1' }, payload: { code: 'B3' } },
      { sync: true },
    );
    expect(result.channels).toEqual(['EMAIL']);
  });

  it('tells the commit observer AFTER the row exists, with the tenant', async () => {
    const seen: { notificationId: string; userId: string; clientId: string | null }[] = [];
    const api = mount({
      onCommitted: (committed) => {
        // Read-your-own-hint: the row must be findable by the time we are told.
        expect(db.rows.notifications.map((row) => row.id)).toContain(committed.notificationId);
        seen.push(committed);
      },
    });

    await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1', clientId: 'c9' }, payload: { code: 'B4' } },
      { sync: true },
    );
    expect(seen).toEqual([
      { notificationId: db.rows.notifications[0]?.id, userId: 'u1', clientId: 'c9' },
    ]);
  });

  it('never lets a throwing observer turn a delivered notification into a 500', async () => {
    const api = mount({
      onCommitted: () => {
        throw new Error('bus down');
      },
    });
    await expect(
      api.notify(
        { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'B5' } },
        { sync: true },
      ),
    ).resolves.toMatchObject({ channels: [] });
  });

  it('hands dispatch to the host queue instead of sending in-process', async () => {
    const queued: string[] = [];
    const api = mount({
      scheduleDispatch: (id) => {
        queued.push(id);
        return Promise.resolve();
      },
    });
    const email = fakeTransport('EMAIL');
    withTransports(api, email);

    const result = await api.notify({
      type: 'order.paid',
      recipient: { userId: 'u1' },
      payload: { code: 'B6' },
    });

    expect(queued).toEqual([result.notificationId]);
    // Nothing sent yet: the delivery row is the durable record, and the worker
    // is what turns it into a send.
    expect(email.sent).toEqual([]);
    expect(db.rows.deliveries[0]?.status).toBe('QUEUED');
  });

  it('`sync` overrides the queue — a worker about to exit must send here', async () => {
    const queued: string[] = [];
    const api = mount({
      scheduleDispatch: (id) => {
        queued.push(id);
        return Promise.resolve();
      },
    });
    const email = fakeTransport('EMAIL');
    withTransports(api, email);

    await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'B7' } },
      { sync: true },
    );
    expect(queued).toEqual([]);
    expect(email.sent).toHaveLength(1);
  });

  it('accepts a generator registered after the mount', async () => {
    const api = mount();
    api.registerGenerator({
      type: 'stock.low',
      category: 'stock',
      generate: () => ({ title: 'Estoque baixo', body: 'Repor item.' }),
    });
    await api.notify(
      { type: 'stock.low', recipient: { userId: 'u1' }, payload: {} },
      { sync: true },
    );
    expect(db.rows.notifications[0]?.category).toBe('stock');
  });
});
