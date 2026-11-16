/* eslint-disable test-flakiness/no-global-state-mutation --
   `sends` RECORDS what the phone transports were handed; each case builds its own. */
import { describe, expect, it } from 'vitest';

import type { ApiNotifications } from '../create-api-notifications';

import {
  clinicConsent,
  consentOf,
  deliveriesOf,
  mountContract,
  mutableContacts,
  phoneTransport,
  U1_E164,
  type ContractConfig,
  type PhoneSend,
} from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 review N4 — a STOP is always honoured. With `consent` configured, a
 * number that opted out of a paid channel receives nothing more on it, even
 * when the host does not REQUIRE a confirmation on that channel.
 */

const AT = new Date('2026-11-16T15:00:00.000Z');

function mountWith(db: MemoryDb, sends: PhoneSend[], config: ContractConfig): ApiNotifications {
  const api = mountContract(db, { consent: clinicConsent(), ...config });
  api.transports.register(phoneTransport('SMS', sends));
  api.transports.register(phoneTransport('WHATSAPP', sends));
  return api;
}

async function optedOutOfSms(api: ApiNotifications): Promise<void> {
  await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
  await consentOf(api).request('u1', 'SMS');
  await consentOf(api).applyInbound({ channel: 'SMS', from: U1_E164, optOut: true, at: AT, externalId: 'stop-1' });
  expect((await consentOf(api).get('u1')).SMS.status).toBe('OPTED_OUT');
}

const emit = (api: ApiNotifications, code: string) =>
  api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code } }, { sync: true });

describe('an opt-out on a channel consent does not require', () => {
  it.each([[['WHATSAPP'] as const], [[] as const]])('stops sends on it (requireConsent %j)', async (requireConsent) => {
    const sends: PhoneSend[] = [];
    const api = mountWith(createMemoryDb(), sends, { requireConsent });
    await optedOutOfSms(api);
    sends.length = 0;
    expect((await emit(api, 'A')).channels).not.toContain('SMS');
    expect(sends).toEqual([]);
  });

  it('a delivery queued before the STOP is not sent after it: the row is DEAD', async () => {
    const db = createMemoryDb();
    const sends: PhoneSend[] = [];
    const api = mountWith(db, sends, { requireConsent: ['WHATSAPP'], scheduleDispatch: () => Promise.resolve() });
    await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
    const { notificationId, channels } = await api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'Q' } });
    expect(channels).toContain('SMS');
    await consentOf(api).request('u1', 'SMS');
    await consentOf(api).applyInbound({ channel: 'SMS', from: U1_E164, optOut: true, at: AT, externalId: 'stop-1' });
    sends.length = 0;
    await api.dispatchDeliveries(notificationId);
    expect(sends).toEqual([]);
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DEAD');
  });

  it('the opt-out belongs to the number: a new phone receives again', async () => {
    const sends: PhoneSend[] = [];
    const contacts = mutableContacts();
    const api = mountWith(createMemoryDb(), sends, { requireConsent: ['WHATSAPP'], contacts });
    await optedOutOfSms(api);
    const person = contacts.people.u1;
    if (!person) throw new Error('fixture');
    person.phone = '+5521911112222';
    expect((await emit(api, 'B')).channels).toContain('SMS');
  });

  it('without `consent` nothing is read or gated (today\'s behaviour)', async () => {
    const sends: PhoneSend[] = [];
    const api = mountContract(createMemoryDb(), {});
    api.transports.register(phoneTransport('SMS', sends));
    await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
    expect((await emit(api, 'C')).channels).toContain('SMS');
  });
});
