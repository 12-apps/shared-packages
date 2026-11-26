/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   every `api`, `db`, `sends` and double is a LOCAL of its own case (the isolation
   rule reads a name reused across cases as shared state);
   `sends` RECORDS what the phone transports were handed; each case builds its own. */
import { describe, expect, it } from 'vitest';

import type { NotificationChannel, NotificationContent, NotificationTransport, TransportRecipient } from '../../types';
import type { ApiNotifications } from '../create-api-notifications';
import { NotificationProviderError } from '../transports/drivers';

import {
  clinicConsent,
  consentOf,
  deliveriesOf,
  mountContract,
  phoneTransport,
  U1_E164,
  type ContractConfig,
  type PhoneSend,
} from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * A GUEST recipient (`notifyGuest`): a phone with no account, told on a paid
 * phone channel about a place a store holds for them. Only the channels the
 * type declares, never one the host requires a confirmation on, never past the
 * number's STOP, and within the caps — the person's day counted by PHONE.
 */

const AT = new Date('2026-11-26T15:00:00.000Z');
const GUEST_PHONE = '(11) 91234-5678';
const GUEST_E164 = '+5511912345678';

/** A type for a guest: it declares the phone channels it may use. */
const PLACE_READY = {
  type: 'place.ready',
  category: 'orders',
  channels: ['SMS', 'WHATSAPP'] as const,
  generate: (payload: { code: string }) => ({ title: 'Sua vez', body: `Lugar ${payload.code}: apresente-se.` }),
};

/** An account's type, as every existing emit has it (no declared channels). */
const ORDER_PAID = {
  type: 'order.paid',
  category: 'orders',
  generate: (payload: { code: string }) => ({ title: 'Pago', body: `Pedido ${payload.code}.` }),
};

const CAPS = { timeZone: 'America/Sao_Paulo', perRecipientDaily: () => 2, perTenantMonthly: () => 100 };

function mountGuest(db: MemoryDb, sends: PhoneSend[], config: ContractConfig = {}): ApiNotifications {
  const api = mountContract(db, {
    consent: clinicConsent(),
    requireConsent: ['WHATSAPP'],
    caps: CAPS,
    generators: [PLACE_READY as never, ORDER_PAID as never],
    ...config,
  });
  api.transports.register(phoneTransport('SMS', sends));
  api.transports.register(phoneTransport('WHATSAPP', sends));
  return api;
}

const tellGuest = (api: ApiNotifications, code: string, phone = GUEST_PHONE) =>
  api.notifyGuest(
    { type: 'place.ready', recipient: { phone, clientId: 'store-1' }, payload: { code } },
    { sync: true },
  );

/** An SMS transport whose provider answers Twilio's 21610: the person replied STOP to the carrier. */
function carrierStoppedSms(): NotificationTransport<{ text: string }> {
  return {
    channel: 'SMS' as NotificationChannel,
    supports: (recipient: TransportRecipient) => recipient.phone !== null,
    format: (content: NotificationContent) => ({ text: content.body }),
    send: () =>
      Promise.reject(new NotificationProviderError('Twilio', 400, '{"code":21610,"message":"unsubscribed"}')),
  } as unknown as NotificationTransport<{ text: string }>;
}

describe('a guest send', () => {
  it('reaches the phone on SMS only, as a row in nobody\'s inbox', async () => {
    const db = createMemoryDb();
    const sends: PhoneSend[] = [];
    const api = mountGuest(db, sends);

    const result = await tellGuest(api, 'A1');

    // WhatsApp needs a confirmation the guest has no account to give.
    expect(result.channels).toEqual(['SMS']);
    expect(sends).toEqual([expect.objectContaining({ channel: 'SMS', phone: GUEST_E164, userId: '' })]);
    expect(db.rows.notifications.find((row) => row.id === result.notificationId)).toMatchObject({
      userId: null,
      recipientPhone: GUEST_E164,
      clientId: 'store-1',
    });
    expect(deliveriesOf(db, result.notificationId).map((row) => row.status)).toEqual(['SENT']);
  });

  it('is refused for a type that declares no channels, and with no consent configured', async () => {
    const sends: PhoneSend[] = [];
    const api = mountGuest(createMemoryDb(), sends);
    await expect(
      api.notifyGuest({ type: 'order.paid', recipient: { phone: GUEST_PHONE, clientId: 'store-1' }, payload: { code: 'X' } }),
    ).rejects.toThrow(/declares no channels/);

    const bare = mountContract(createMemoryDb(), { generators: [PLACE_READY as never] });
    bare.transports.register(phoneTransport('SMS', sends));
    await expect(tellGuest(bare, 'Y')).rejects.toThrow(/needs `consent` configured/);
    expect(sends).toEqual([]);
  });
});

describe('a guest\'s STOP, kept by phone', () => {
  it('an opt-out from the number stops the next guest send, with no account behind it', async () => {
    const db = createMemoryDb();
    const sends: PhoneSend[] = [];
    const api = mountGuest(db, sends);
    const outcome = await consentOf(api).applyInbound({ channel: 'SMS', from: GUEST_E164, optOut: true, at: AT, externalId: 'stop-g' });
    expect(outcome.userIds).toEqual([]);
    expect(db.rows.consents).toEqual([
      expect.objectContaining({ userId: null, destination: GUEST_E164, channel: 'SMS', status: 'OPTED_OUT' }),
    ]);

    expect((await tellGuest(api, 'B')).channels).toEqual([]);
    expect(sends).toEqual([]);
    // A second STOP is the same row, not a second one.
    await consentOf(api).applyInbound({ channel: 'SMS', from: GUEST_E164, optOut: true, at: AT, externalId: 'stop-g2' });
    expect(db.rows.consents).toHaveLength(1);
  });

  it('a send queued before the STOP is not sent after it: the row is DEAD', async () => {
    const db = createMemoryDb();
    const sends: PhoneSend[] = [];
    const api = mountGuest(db, sends, { scheduleDispatch: () => Promise.resolve() });
    const { notificationId, channels } = await api.notifyGuest({
      type: 'place.ready',
      recipient: { phone: GUEST_PHONE, clientId: 'store-1' },
      payload: { code: 'C' },
    });
    expect(channels).toEqual(['SMS']);
    await consentOf(api).applyInbound({ channel: 'SMS', from: GUEST_E164, optOut: true, at: AT, externalId: 'stop-g' });

    await api.dispatchDeliveries(notificationId);
    expect(sends).toEqual([]);
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DEAD');
  });

  it('an account\'s STOP on the same number stops the guest send too', async () => {
    const sends: PhoneSend[] = [];
    const api = mountGuest(createMemoryDb(), sends);
    await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
    await consentOf(api).request('u1', 'SMS');
    await consentOf(api).applyInbound({ channel: 'SMS', from: U1_E164, optOut: true, at: AT, externalId: 'stop-1' });
    sends.length = 0;

    expect((await tellGuest(api, 'D', U1_E164)).channels).toEqual([]);
    expect(sends).toEqual([]);
  });

  it('a carrier STOP (the provider refuses the number) is recorded for the number', async () => {
    const db = createMemoryDb();
    const api = mountContract(db, {
      consent: clinicConsent(),
      requireConsent: ['WHATSAPP'],
      generators: [PLACE_READY as never],
    });
    api.transports.register(carrierStoppedSms());

    const first = await tellGuest(api, 'E');
    expect(deliveriesOf(db, first.notificationId)[0]?.status).toBe('DEAD');
    expect(db.rows.consents).toEqual([
      expect.objectContaining({ userId: null, destination: GUEST_E164, channel: 'SMS', status: 'OPTED_OUT' }),
    ]);
    expect((await tellGuest(api, 'F')).channels).toEqual([]);
  });
});

describe('the caps, for a guest', () => {
  it('count the guest\'s day by PHONE, and the store\'s month', async () => {
    const db = createMemoryDb();
    const sends: PhoneSend[] = [];
    const api = mountGuest(db, sends);

    expect((await tellGuest(api, '1')).channels).toEqual(['SMS']);
    expect((await tellGuest(api, '2')).channels).toEqual(['SMS']);
    // The third message of the day to this number is over the person's cap of 2…
    expect((await tellGuest(api, '3')).channels).toEqual([]);
    // …and another number has its own day.
    expect((await tellGuest(api, '4', '(21) 99876-5432')).channels).toEqual(['SMS']);

    expect(sends.map((send) => send.phone)).toEqual([GUEST_E164, GUEST_E164, '+5521998765432']);
    const counts = Object.fromEntries(db.rows.counters.map((row) => [`${row.scope}:${row.subjectId}`, row.count]));
    expect(counts).toMatchObject({ [`recipient:guest:${GUEST_E164}`]: 2, 'recipient:guest:+5521998765432': 1, 'tenant:store-1': 3 });
  });

  it('key the same number written two ways to ONE day and ONE STOP', async () => {
    const SPACED = '+55 11 99999-0000';
    const BARE = '5511999990000';
    const db = createMemoryDb();
    const sends: PhoneSend[] = [];
    const api = mountGuest(db, sends);

    expect((await tellGuest(api, '1', SPACED)).channels).toEqual(['SMS']);
    expect((await tellGuest(api, '2', BARE)).channels).toEqual(['SMS']);
    // The third send of the day is over the cap whichever spelling asks.
    expect((await tellGuest(api, '3', SPACED)).channels).toEqual([]);
    expect(db.rows.counters.filter((row) => row.scope === 'recipient')).toEqual([
      expect.objectContaining({ subjectId: 'guest:+5511999990000', count: 2 }),
    ]);

    // A STOP from one spelling stops the other, on a fresh store with a clean day.
    const stopDb = createMemoryDb();
    const stopApi = mountGuest(stopDb, sends);
    await consentOf(stopApi).applyInbound({ channel: 'SMS', from: BARE, optOut: true, at: AT, externalId: 'stop-b' });
    expect((await tellGuest(stopApi, '4', SPACED)).channels).toEqual([]);
    expect(stopDb.rows.consents).toEqual([
      expect.objectContaining({ userId: null, destination: '+5511999990000', status: 'OPTED_OUT' }),
    ]);
    expect(sends.map((send) => send.phone)).toEqual(['+5511999990000', '+5511999990000']);
  });

  it('leave an account\'s day untouched: a guest of the same number is counted apart', async () => {
    const db = createMemoryDb();
    const sends: PhoneSend[] = [];
    const api = mountGuest(db, sends);
    await tellGuest(api, '1', U1_E164);
    await tellGuest(api, '2', U1_E164);

    expect(db.rows.counters.find((row) => row.subjectId === 'u1')).toBeUndefined();
  });
});

describe('an account send, unchanged', () => {
  it('still reaches the account by its contact, with its userId on the row and the delivery', async () => {
    const db = createMemoryDb();
    const sends: PhoneSend[] = [];
    const api = mountGuest(db, sends, { requireConsent: [] });
    await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });

    const result = await api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'U' } }, { sync: true });

    expect(result.channels).toEqual(['SMS']);
    expect(sends).toEqual([expect.objectContaining({ channel: 'SMS', userId: 'u1', phone: U1_E164 })]);
    const row = db.rows.notifications.find((entry) => entry.id === result.notificationId);
    expect(row?.userId).toBe('u1');
    expect(row?.recipientPhone ?? null).toBeNull();
    expect(db.rows.counters.find((entry) => entry.subjectId === 'u1')?.count).toBe(1);
  });
});
