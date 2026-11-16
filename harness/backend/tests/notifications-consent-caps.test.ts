/* eslint-disable test-flakiness/no-database-operations, test-flakiness/no-unmocked-fs,
   test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   the database is the subject: FUT-285's concurrency and forward-only
   contracts, on the PUBLISHED tarball's own migrations over a real Postgres
   (PGlite), one fresh database per case (`pg` is rebuilt in `beforeEach`; the
   fakes count their own sends). */
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NotificationContent, NotificationTransport, TransportRecipient } from '@12-apps/notifications';
import * as server from '@12-apps/notifications/server';
import { createApiNotifications, type ApiNotifications } from '@12-apps/notifications/server';

import { applyNotificationMigrations, notificationsDb } from '../src/notifications-db';

/**
 * FUT-285 (W14 PR-A) — the contract's REAL-SQL half.
 *
 * The unit suites pin the same rules against the in-memory seam, where every
 * delegate call is atomic by construction. What only exists HERE is the SQL:
 * the new columns and CHECKs from the package's migration, the partial unique
 * index on (channel, provider_message_id), and the conditional statements that
 * make "increment below the cap", "notify the tenant once" and "a receipt only
 * moves forward" hold between concurrent callers — an in-memory double can
 * agree with a read-then-write translation that Postgres would not.
 *
 * On `main`: the columns, tables and APIs below do not exist, an 11th paid
 * message is sent, and a receipt changes nothing.
 */

const UNIT = 'harness-consent';

/** A fixed instant for receipts and replies whose time the case does not read. */
const AT = new Date('2026-11-16T15:00:00.000Z');

let pg: PGlite;

beforeEach(async () => {
  pg = new PGlite();
  await applyNotificationMigrations(pg);
});

afterEach(async () => {
  await pg.close();
});

interface Send {
  channel: string;
  userId: string;
  text: string;
}

const PEOPLE: Record<string, { email: string | null; phone: string | null; firstName?: string }> = {
  u1: { email: 'ana@harness.dev', phone: '+5511987654321', firstName: 'Ana' },
  u2: { email: 'bia@harness.dev', phone: '+5531999998888', firstName: 'Bia' },
  u3: { email: 'caio@harness.dev', phone: '+5531988887777', firstName: 'Caio' },
};

function phone(channel: 'SMS' | 'WHATSAPP', sends: Send[], fail: () => boolean = () => false): NotificationTransport<{ text: string }> {
  let sequence = 0;
  return {
    channel,
    supports: (recipient: TransportRecipient) => recipient.phone !== null,
    format: (content: NotificationContent) => ({ text: `${content.title}|${content.body}` }),
    send: (message: { text: string }, recipient: TransportRecipient) => {
      if (fail()) return Promise.reject(new Error(`${channel} down`));
      sequence += 1;
      sends.push({ channel, userId: recipient.userId, text: message.text });
      return Promise.resolve({ providerMessageId: `${UNIT}-${channel}-${sequence}` });
    },
  } as unknown as NotificationTransport<{ text: string }>;
}

function mount(config: Record<string, unknown>, sends: Send[], fail?: () => boolean): ApiNotifications {
  const api = createApiNotifications({
    db: () => Promise.resolve(notificationsDb(pg)),
    contacts: { getContact: (userId: string) => Promise.resolve(PEOPLE[userId] ?? null) },
    categories: ['orders'],
    messages: {} as never,
    generators: [
      {
        type: 'order.paid',
        category: 'orders',
        generate: (payload: { code: string }) => ({ title: 'Pago', body: `Pedido ${payload.code}` }),
      } as never,
    ],
    logger: { info: () => undefined, error: () => undefined },
    ...config,
  } as Parameters<typeof createApiNotifications>[0]);
  api.transports.register(phone('SMS', sends, fail));
  api.transports.register(phone('WHATSAPP', sends, fail));
  return api;
}

const consent = {
  methods: { SMS: 'CODE', WHATSAPP: 'REPLY' },
  confirmKeywords: ['SIM'],
  optOutKeywords: ['SAIR'],
  defaultCountryCode: '55',
  message: (input: { code?: string }) => ({ title: 'Confirme', body: input.code ? `código ${input.code}` : 'Responda SIM' }),
};

interface ConsentApi {
  request(userId: string, channel: string): Promise<{ status: string }>;
  confirmCode(userId: string, channel: string, code: string): Promise<{ status: string }>;
  applyInbound(input: Record<string, unknown>): Promise<{ outcome: string }>;
  get(userId: string): Promise<Record<string, { status: string }>>;
}

function consentOf(api: ApiNotifications): ConsentApi {
  const value = (api as unknown as { consent?: ConsentApi }).consent;
  if (!value) throw new Error('FUT-285 contract: api.consent is not implemented');
  return value;
}

function receiptsOf(api: ApiNotifications): (input: Record<string, unknown>) => Promise<{ applied: boolean }> {
  const value = (api as unknown as { applyDeliveryReceipt?: (input: Record<string, unknown>) => Promise<{ applied: boolean }> }).applyDeliveryReceipt;
  if (!value) throw new Error('FUT-285 contract: api.applyDeliveryReceipt is not implemented');
  return value;
}

const emit = (api: ApiNotifications, userId: string, clientId?: string) =>
  api.notify(
    { type: 'order.paid', recipient: { userId, ...(clientId ? { clientId } : {}) }, payload: { code: 'H' } },
    { sync: true },
  );

async function columns(table: string): Promise<string[]> {
  const { rows } = await pg.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.map((row) => row.column_name);
}

describe('the package migration', () => {
  it('adds provider_message_id and delivered_at to notification_deliveries', async () => {
    expect(await columns('notification_deliveries')).toEqual(
      expect.arrayContaining(['provider_message_id', 'delivered_at']),
    );
  });

  it('widens the status CHECK to DELIVERED and UNDELIVERED, and no further', async () => {
    const { rows } = await pg.query<{ id: string }>(
      `INSERT INTO notifications (id, user_id, type, category, title, body, data)
       VALUES ('n1', 'u1', 't', 'orders', 'a', 'b', '{}') RETURNING id`,
    );
    expect(rows).toHaveLength(1);
    for (const [index, status] of ['DELIVERED', 'UNDELIVERED'].entries()) {
      await pg.query(
        `INSERT INTO notification_deliveries (id, notification_id, channel, status, updated_at) VALUES ($1, 'n1', $2, $3, NOW())`,
        [`d${index}`, ['SMS', 'WHATSAPP'][index], status],
      );
    }
    await expect(
      pg.query(
        `INSERT INTO notification_deliveries (id, notification_id, channel, status, updated_at) VALUES ('d9', 'n1', 'EMAIL', 'BOUNCED', NOW())`,
      ),
    ).rejects.toThrow();
  });

  it('refuses a second row with the same (channel, provider_message_id), and allows many NULLs', async () => {
    await pg.query(
      `INSERT INTO notifications (id, user_id, type, category, title, body, data) VALUES
       ('n1', 'u1', 't', 'orders', 'a', 'b', '{}'), ('n2', 'u1', 't', 'orders', 'a', 'b', '{}')`,
    );
    await pg.query(
      `INSERT INTO notification_deliveries (id, notification_id, channel, status, provider_message_id, updated_at) VALUES
       ('d1', 'n1', 'SMS', 'SENT', 'SM1', NOW()), ('d2', 'n1', 'EMAIL', 'SENT', NULL, NOW()),
       ('d3', 'n2', 'EMAIL', 'SENT', NULL, NOW()), ('d4', 'n2', 'WHATSAPP', 'SENT', 'SM1', NOW())`,
    );
    await expect(
      pg.query(
        `INSERT INTO notification_deliveries (id, notification_id, channel, status, provider_message_id, updated_at)
         VALUES ('d5', 'n2', 'SMS', 'SENT', 'SM1', NOW())`,
      ),
    ).rejects.toThrow();
  });

  it('creates the consent and counter tables', async () => {
    expect(await columns('notification_channel_consents')).toEqual(
      expect.arrayContaining(['user_id', 'channel', 'destination', 'status']),
    );
    expect(await columns('notification_send_counters')).toEqual(
      expect.arrayContaining(['scope', 'subject_id', 'period', 'count', 'notified_at']),
    );
  });

  it('is replay-safe: applying every migration twice is a no-op', async () => {
    await expect(applyNotificationMigrations(pg)).resolves.toBeUndefined();
  });
});

describe('caps over real SQL', () => {
  it('N parallel creations at cap-1: exactly one passes, and the counter stops at the cap', async () => {
    const sends: Send[] = [];
    const api = mount(
      { caps: { timeZone: 'America/Sao_Paulo', perRecipientDaily: () => 3, perTenantMonthly: () => 100 } },
      sends,
    );
    await api.preferences.save('u1', { orders: { SMS: true } });
    await emit(api, 'u1');
    await emit(api, 'u1');
    const results = await Promise.all(Array.from({ length: 12 }, () => emit(api, 'u1')));
    expect(results.filter((result) => result.channels.includes('SMS'))).toHaveLength(1);
    expect(sends).toHaveLength(3);
    const { rows } = await pg.query<{ count: number }>(
      `SELECT count FROM notification_send_counters WHERE scope = 'recipient' AND subject_id = 'u1'`,
    );
    expect(rows.map((row) => Number(row.count))).toEqual([3]);
  });

  it('the tenant hook fires exactly once under concurrency', async () => {
    const reached: string[] = [];
    const api = mount(
      {
        caps: {
          timeZone: 'America/Sao_Paulo',
          perRecipientDaily: () => 100,
          perTenantMonthly: () => 1,
          onTenantCapReached: (tenantId: string, period: string) => {
            reached.push(`${tenantId}:${period}`);
          },
        },
      },
      [],
    );
    for (const userId of ['u1', 'u2', 'u3']) await api.preferences.save(userId, { orders: { SMS: true } });
    await Promise.all(Array.from({ length: 12 }, (_, i) => emit(api, ['u1', 'u2', 'u3'][i % 3] ?? 'u1', 't1')));
    expect(reached).toHaveLength(1);
  });
});

describe('receipts over real SQL', () => {
  it('a receipt racing its SENT write is not applied; retried after it, it is', async () => {
    const sends: Send[] = [];
    const api = mount({ scheduleDispatch: () => Promise.resolve() }, sends);
    await api.preferences.save('u1', { orders: { SMS: true } });
    const { notificationId } = await api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'R' } });
    const receipt = { channel: 'SMS', providerMessageId: `${UNIT}-SMS-1`, status: 'DELIVERED', at: AT };

    expect(await receiptsOf(api)(receipt)).toEqual({ applied: false });
    await api.dispatchDeliveries(notificationId);
    expect(await receiptsOf(api)(receipt)).toEqual({ applied: true });

    const { rows } = await pg.query<{ status: string; provider_message_id: string; delivered_at: Date | null }>(
      `SELECT status, provider_message_id, delivered_at FROM notification_deliveries WHERE notification_id = $1 AND channel = 'SMS'`,
      [notificationId],
    );
    expect(rows[0]).toMatchObject({ status: 'DELIVERED', provider_message_id: `${UNIT}-SMS-1` });
    expect(rows[0]?.delivered_at).not.toBeNull();
  });

  it('two conflicting terminal receipts at once: exactly one is applied', async () => {
    const api = mount({}, []);
    await api.preferences.save('u1', { orders: { SMS: true } });
    await emit(api, 'u1');
    const base = { channel: 'SMS', providerMessageId: `${UNIT}-SMS-1`, at: AT };
    const results = await Promise.all([
      receiptsOf(api)({ ...base, status: 'DELIVERED' }),
      receiptsOf(api)({ ...base, status: 'UNDELIVERED', error: '30008' }),
    ]);
    expect(results.filter((result) => result.applied)).toHaveLength(1);
  });
});

describe('consent over real SQL', () => {
  it('nothing is retried after SAIR: a FAILED WhatsApp row is not sent by the sweep', async () => {
    const sends: Send[] = [];
    let down = false;
    const api = mount({ requireConsent: ['SMS', 'WHATSAPP'], consent }, sends, () => down);
    await api.preferences.save('u1', { orders: { WHATSAPP: true } });
    await consentOf(api).request('u1', 'WHATSAPP');
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: '5511987654321', text: 'SIM', at: AT, externalId: 'w-sim' });
    sends.length = 0;
    down = true;
    const { notificationId } = await emit(api, 'u1');

    await Promise.all([
      consentOf(api).applyInbound({ channel: 'WHATSAPP', from: '5511987654321', text: 'SAIR', at: AT, externalId: 'w-out' }),
      pg.query(`UPDATE notification_deliveries SET updated_at = NOW() - interval '1 hour'`),
    ]);
    down = false;
    await api.drainPending(0);
    await api.drainPending(0);

    expect(sends).toEqual([]);
    const { rows } = await pg.query<{ status: string }>(
      `SELECT status FROM notification_deliveries WHERE notification_id = $1 AND channel = 'WHATSAPP'`,
      [notificationId],
    );
    expect(rows[0]?.status).toBe('DEAD');
  });

  it('20 parallel wrong codes still lock the code (attempts counted in the database)', async () => {
    const sends: Send[] = [];
    const api = mount({ requireConsent: ['SMS'], consent }, sends);
    await consentOf(api).request('u1', 'SMS');
    const right = sends.at(-1)?.text.match(/\d{6}/)?.[0] ?? '';
    const wrong = right === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 20 }, () => consentOf(api).confirmCode('u1', 'SMS', wrong)));
    expect((await consentOf(api).confirmCode('u1', 'SMS', right)).status).toBe('TOO_MANY_ATTEMPTS');
  });

  it('the consent record keeps no code in clear', async () => {
    const sends: Send[] = [];
    const api = mount({ requireConsent: ['SMS'], consent }, sends);
    await consentOf(api).request('u1', 'SMS');
    const code = sends.at(-1)?.text.match(/\d{6}/)?.[0] ?? 'missing';
    const { rows } = await pg.query(`SELECT * FROM notification_channel_consents`);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('exports the cap defaults from the server entry', () => {
    expect((server as Record<string, unknown>).DEFAULT_PER_RECIPIENT_DAILY_CAP).toBe(10);
    expect((server as Record<string, unknown>).DEFAULT_PER_TENANT_MONTHLY_CAP).toBe(500);
  });
});
