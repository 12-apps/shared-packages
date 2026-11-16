/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   `db`, `sends` and `observed` are rebuilt per case in `beforeEach`; the rule
   flags the module-scoped bindings they are assigned to, and appending to the
   recorders is what the assertions read. */
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransportRecipient } from '../../types';
import type { FetchImpl } from '../transports/drivers';
import { smsTransport } from '../transports/sms';
import { whatsAppTransport } from '../transports/whatsapp';

import {
  clinicConsent,
  consentOf,
  deliveriesOf,
  mountContract,
  phoneTransport,
  receiptsOf,
  type AppliedReceipt,
  type PhoneSend,
} from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 contract — delivery receipts.
 *
 * On `main` a delivery can never be matched to a provider receipt: `send()`
 * resolves `void` (`types.ts:247`), `postOrThrow` reads the body only on an
 * error (`transports/drivers.ts:63-74`), and SENT is written with no id
 * (`dispatch.ts:179-182`). The status set stops at SENT (`types.ts:55`).
 *
 * The contract: the provider's id is kept on the row with SENT, and a receipt
 * moves a row FORWARD only — SENT → DELIVERED | UNDELIVERED, READ folded into
 * DELIVERED, the first terminal answer wins, a duplicate changes nothing, and a
 * receipt that arrives before its SENT write says so (`applied: false`) so the
 * host's job retries it instead of losing it.
 */

/** A fixed instant for receipts and replies whose time the case does not read. */
const AT = new Date('2026-11-16T15:00:00.000Z');

const recipient: TransportRecipient = {
  userId: 'u1',
  email: null,
  phone: '+5511987654321',
  clientId: null,
  side: null,
  pushSubscriptionCount: 0,
};

/** A fetch double answering `body` with 2xx, recording what crossed the wire. */
function answering(body: unknown): { fetchImpl: FetchImpl; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  return {
    calls,
    fetchImpl: (url, init) => {
      calls.push({ url, body: init?.body ?? '' });
      return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve(JSON.stringify(body)) });
    },
  };
}

describe('the provider id is kept', () => {
  it('the twilio driver answers the message sid', async () => {
    const { fetchImpl } = answering({ sid: 'SM0123456789abcdef', status: 'queued' });
    const transport = smsTransport({
      channel: 'SMS',
      driver: 'twilio',
      accountSid: 'AC1',
      authToken: 'token',
      from: '+15550001111',
      defaultCountryCode: '55',
      fetchImpl,
    });
    const result: unknown = await transport.send({ body: 'Oi' }, recipient);
    expect(result).toEqual({ providerMessageId: 'SM0123456789abcdef' });
  });

  it('the meta driver answers messages[0].id', async () => {
    const { fetchImpl } = answering({
      messaging_product: 'whatsapp',
      contacts: [{ input: '5511987654321', wa_id: '5511987654321' }],
      messages: [{ id: 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABEYEjQ' }],
    });
    const transport = whatsAppTransport({
      channel: 'WHATSAPP',
      driver: 'meta',
      accessToken: 'token',
      phoneNumberId: '106540352242922',
      templateName: 'aviso',
      templateLanguage: 'pt_BR',
      defaultCountryCode: '55',
      fetchImpl,
    });
    const result: unknown = await transport.send(
      { text: 'Oi', templateParameters: ['Oi', 'corpo'] },
      recipient,
    );
    expect(result).toEqual({ providerMessageId: 'wamid.HBgNNTUxMTk4NzY1NDMyMRUCABEYEjQ' });
  });

  it('the log drivers answer a fake id, distinct per send, so dev and e2e exercise receipts', async () => {
    const sms = smsTransport({ channel: 'SMS', driver: 'log', defaultCountryCode: '55' });
    const whatsapp = whatsAppTransport({
      channel: 'WHATSAPP',
      driver: 'log',
      templateLanguage: 'pt_BR',
      defaultCountryCode: '55',
    });
    const ids = [
      await sms.send({ body: 'a' }, recipient),
      await sms.send({ body: 'b' }, recipient),
      await whatsapp.send({ text: 'c', templateParameters: ['c', 'c'] }, recipient),
    ].map((result: unknown) => (result as { providerMessageId?: string } | undefined)?.providerMessageId);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });
});

let db: MemoryDb;
let sends: PhoneSend[];
let observed: AppliedReceipt[];

beforeEach(() => {
  db = createMemoryDb();
  sends = [];
  observed = [];
});

/** A mount with SMS + WhatsApp on for u1, consent NOT required (receipts stand alone). */
async function sentOne(channel: 'SMS' | 'WHATSAPP' = 'SMS') {
  const api = mountContract(db, { onDeliveryReceipt: (receipt) => observed.push(receipt) });
  api.transports.register(phoneTransport('SMS', sends));
  api.transports.register(phoneTransport('WHATSAPP', sends));
  await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, [channel]: true } });
  const { notificationId } = await api.notify(
    { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'R1' } },
    { sync: true },
  );
  const row = deliveriesOf(db, notificationId)[0];
  if (!row) throw new Error('no delivery row');
  return { api, notificationId, row };
}

describe('dispatch writes the provider id with SENT', () => {
  it('the SENT row carries the id the transport answered', async () => {
    const { row } = await sentOne();
    expect(row.status).toBe('SENT');
    expect(row.providerMessageId).toBe('sms-msg-1');
    expect(row.deliveredAt ?? null).toBeNull();
  });
});

describe('applyDeliveryReceipt — forward only', () => {
  it('SENT → DELIVERED, stamped with the receipt time, and the observer is told once', async () => {
    const { api, row, notificationId } = await sentOne();
    const at = new Date('2026-11-16T12:00:05.000Z');
    const result = await receiptsOf(api)({
      channel: 'SMS',
      providerMessageId: 'sms-msg-1',
      status: 'DELIVERED',
      at,
    });
    expect(result).toEqual({ applied: true });
    const after = deliveriesOf(db, notificationId)[0];
    expect(after).toMatchObject({ id: row.id, status: 'DELIVERED', deliveredAt: at });
    expect(observed).toEqual([
      expect.objectContaining({
        deliveryId: row.id,
        notificationId,
        userId: 'u1',
        channel: 'SMS',
        status: 'DELIVERED',
        at,
        permanent: false,
      }),
    ]);
  });

  it('READ is folded into DELIVERED', async () => {
    const { api, notificationId } = await sentOne('WHATSAPP');
    await receiptsOf(api)({
      channel: 'WHATSAPP',
      providerMessageId: 'whatsapp-msg-1',
      status: 'READ',
      at: new Date('2026-11-16T12:01:00.000Z'),
    });
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DELIVERED');
  });

  it('SENT → UNDELIVERED keeps the provider error', async () => {
    const { api, notificationId } = await sentOne();
    const result = await receiptsOf(api)({
      channel: 'SMS',
      providerMessageId: 'sms-msg-1',
      status: 'UNDELIVERED',
      at: new Date('2026-11-16T12:00:05.000Z'),
      error: '30008 Unknown error',
    });
    expect(result).toEqual({ applied: true });
    expect(deliveriesOf(db, notificationId)[0]).toMatchObject({
      status: 'UNDELIVERED',
      error: '30008 Unknown error',
    });
  });

  it('a duplicate receipt changes nothing and is not observed twice', async () => {
    const { api, notificationId } = await sentOne();
    const first = new Date('2026-11-16T12:00:05.000Z');
    const receipt = { channel: 'SMS' as const, providerMessageId: 'sms-msg-1', status: 'DELIVERED' as const };
    await receiptsOf(api)({ ...receipt, at: first });
    const again = await receiptsOf(api)({ ...receipt, at: new Date('2026-11-16T12:09:00.000Z') });
    expect(again).toEqual({ applied: false });
    expect(deliveriesOf(db, notificationId)[0]?.deliveredAt).toEqual(first);
    expect(observed).toHaveLength(1);
  });

  it('the first terminal answer wins: UNDELIVERED after DELIVERED changes nothing', async () => {
    const { api, notificationId } = await sentOne();
    const apply = receiptsOf(api);
    await apply({ channel: 'SMS', providerMessageId: 'sms-msg-1', status: 'DELIVERED', at: new Date('2026-11-16T12:00:05.000Z') });
    expect(
      await apply({ channel: 'SMS', providerMessageId: 'sms-msg-1', status: 'UNDELIVERED', at: new Date('2026-11-16T12:00:06.000Z') }),
    ).toEqual({ applied: false });
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DELIVERED');
    expect(observed).toHaveLength(1);
  });

  it('the first terminal answer wins: a late DELIVERED after UNDELIVERED changes nothing', async () => {
    const { api, notificationId } = await sentOne();
    const apply = receiptsOf(api);
    await apply({ channel: 'SMS', providerMessageId: 'sms-msg-1', status: 'UNDELIVERED', at: new Date('2026-11-16T12:00:05.000Z'), error: '30008' });
    expect(
      await apply({ channel: 'SMS', providerMessageId: 'sms-msg-1', status: 'DELIVERED', at: new Date('2026-11-16T12:00:06.000Z') }),
    ).toEqual({ applied: false });
    expect(deliveriesOf(db, notificationId)[0]).toMatchObject({ status: 'UNDELIVERED', error: '30008' });
  });

  it('a SENT receipt (or any in-flight status) never moves a row backwards', async () => {
    const { api, notificationId } = await sentOne();
    const apply = receiptsOf(api);
    await apply({ channel: 'SMS', providerMessageId: 'sms-msg-1', status: 'DELIVERED', at: new Date('2026-11-16T12:00:05.000Z') });
    expect(
      await apply({ channel: 'SMS', providerMessageId: 'sms-msg-1', status: 'SENT', at: new Date('2026-11-16T12:00:09.000Z') }),
    ).toEqual({ applied: false });
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DELIVERED');
  });

  it('an unknown id, or the right id on the other channel, is not applied', async () => {
    const { api, notificationId } = await sentOne();
    const apply = receiptsOf(api);
    expect(
      await apply({ channel: 'SMS', providerMessageId: 'SM-nobody', status: 'DELIVERED', at: AT }),
    ).toEqual({ applied: false });
    expect(
      await apply({ channel: 'WHATSAPP', providerMessageId: 'sms-msg-1', status: 'DELIVERED', at: AT }),
    ).toEqual({ applied: false });
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('SENT');
    expect(observed).toEqual([]);
  });

  it('a receipt that races its SENT write answers applied:false, and applies once retried after it', async () => {
    const api = mountContract(db, {
      onDeliveryReceipt: (receipt) => observed.push(receipt),
      // Rows stay QUEUED: nothing has been sent, so no row holds the id yet.
      scheduleDispatch: () => Promise.resolve(),
    });
    api.transports.register(phoneTransport('SMS', sends));
    await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
    const { notificationId } = await api.notify({
      type: 'order.paid',
      recipient: { userId: 'u1' },
      payload: { code: 'R2' },
    });
    const early = { channel: 'SMS' as const, providerMessageId: 'sms-msg-1', status: 'DELIVERED' as const, at: new Date('2026-11-16T12:00:05.000Z') };

    expect(await receiptsOf(api)(early)).toEqual({ applied: false });

    await api.dispatchDeliveries(notificationId);
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('SENT');
    expect(await receiptsOf(api)(early)).toEqual({ applied: true });
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DELIVERED');
  });

  it('DELIVERED and UNDELIVERED are terminal for the retry sweep: it never re-sends them', async () => {
    const { api, notificationId } = await sentOne();
    await receiptsOf(api)({ channel: 'SMS', providerMessageId: 'sms-msg-1', status: 'UNDELIVERED', at: AT });
    for (const row of db.rows.deliveries) row.updatedAt = new Date(row.updatedAt.getTime() - 60 * 60_000);
    await api.drainPending(0);
    expect(sends).toHaveLength(1);
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('UNDELIVERED');
  });

  it('a throwing observer never fails the receipt', async () => {
    const api = mountContract(db, {
      onDeliveryReceipt: () => {
        throw new Error('observer down');
      },
    });
    api.transports.register(phoneTransport('SMS', sends));
    await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
    const { notificationId } = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'R3' } },
      { sync: true },
    );
    await expect(
      receiptsOf(api)({ channel: 'SMS', providerMessageId: 'sms-msg-1', status: 'DELIVERED', at: AT }),
    ).resolves.toEqual({ applied: true });
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DELIVERED');
  });
});

describe('a permanent failure on a GRANDFATHERED phone stops sends to it (owner, 2026-11-16)', () => {
  async function grandfatheredMount() {
    const api = mountContract(db, { requireConsent: ['SMS', 'WHATSAPP'], consent: clinicConsent() });
    api.transports.register(phoneTransport('SMS', sends));
    await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
    await consentOf(api).grandfather([{ userId: 'u1', channel: 'SMS' }]);
    const { notificationId } = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'G1' } },
      { sync: true },
    );
    expect(sends).toHaveLength(1);
    return { api, notificationId };
  }

  it('permanent UNDELIVERED: the grandfathering is dropped and the next emit sends nothing on that channel', async () => {
    const { api } = await grandfatheredMount();
    await receiptsOf(api)({
      channel: 'SMS',
      providerMessageId: 'sms-msg-1',
      status: 'UNDELIVERED',
      at: AT,
      error: '30005 Unknown destination handset',
      permanent: true,
    });
    expect((await consentOf(api).get('u1')).SMS.status).toBe('NONE');

    const next = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'G2' } },
      { sync: true },
    );
    expect(next.channels).not.toContain('SMS');
    expect(sends).toHaveLength(1);
  });

  it('a TRANSIENT failure keeps the grandfathered phone receiving', async () => {
    const { api } = await grandfatheredMount();
    await receiptsOf(api)({
      channel: 'SMS',
      providerMessageId: 'sms-msg-1',
      status: 'UNDELIVERED',
      at: AT,
      error: '30003 Unreachable destination handset',
      permanent: false,
    });
    expect((await consentOf(api).get('u1')).SMS.status).toBe('GRANDFATHERED');
    const next = await api.notify(
      { type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'G3' } },
      { sync: true },
    );
    expect(next.channels).toContain('SMS');
  });
});
