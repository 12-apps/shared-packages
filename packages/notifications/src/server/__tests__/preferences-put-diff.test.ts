/* eslint-disable test-flakiness/no-global-state-mutation --
   `sends` RECORDS what the phone transports were handed; each case builds its own. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiNotifications } from '../create-api-notifications';
import type { NotificationsResponse } from '../context';
import { paidChannelsTurnedOn } from '../consent-routes';

import {
  clinicConsent,
  consentOf,
  mountContract,
  mutableContacts,
  phoneTransport,
  U1_E164,
  type PhoneSend,
} from './consent-contract';
import { createMemoryDb } from './memory-db';

/**
 * FUT-285 review N3 — the preferences PUT asks for a confirmation only on a
 * false → true change of SMS or WhatsApp. A client (or an agent) that PUTs the
 * whole matrix on every save restates switches that were already on, and must
 * not send a paid prompt to an opted-out number each time.
 */

const AT = new Date('2026-11-16T15:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AT);
});

afterEach(() => {
  vi.useRealTimers();
});

function mountWith(sends: PhoneSend[]): ApiNotifications {
  const api = mountContract(createMemoryDb(), {
    contacts: mutableContacts(),
    requireConsent: ['SMS', 'WHATSAPP'],
    consent: clinicConsent(),
  });
  api.transports.register(phoneTransport('SMS', sends));
  api.transports.register(phoneTransport('WHATSAPP', sends));
  return api;
}

function put(api: ApiNotifications, body: unknown): Promise<NotificationsResponse> {
  const route = api.routes.find((entry) => entry.method === 'PUT' && entry.path === '/notification-preferences');
  if (!route) throw new Error('no preferences PUT');
  return route.handle({ actor: { userId: 'u1' }, params: {}, query: {}, body });
}

describe('PUT /notification-preferences re-asks only on a false → true change', () => {
  it('a full-matrix save that restates WhatsApp ON sends nothing to an opted-out number', async () => {
    const sends: PhoneSend[] = [];
    const api = mountWith(sends);
    await put(api, { orders: { WHATSAPP: true } });
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SAIR', at: AT, externalId: 'w-out' });
    expect(sends).toHaveLength(1);

    vi.setSystemTime(new Date('2026-11-16T16:00:00.000Z'));
    const response = await put(api, { orders: { EMAIL: false, WHATSAPP: true }, payments: { WHATSAPP: false } });
    expect(response.status).toBe(200);
    expect(sends).toHaveLength(1);
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('OPTED_OUT');
  });

  it('switching it off and on again IS a change, and asks', async () => {
    const sends: PhoneSend[] = [];
    const api = mountWith(sends);
    await put(api, { orders: { WHATSAPP: true } });
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SAIR', at: AT, externalId: 'w-out' });
    vi.setSystemTime(new Date('2026-11-16T16:00:00.000Z'));
    await put(api, { orders: { WHATSAPP: false } });
    await put(api, { orders: { WHATSAPP: true } });
    expect(sends).toHaveLength(2);
  });

  it('paidChannelsTurnedOn diffs against what the person had, category by category', () => {
    const before = { orders: { SMS: true, WHATSAPP: false }, payments: { SMS: false, WHATSAPP: false } };
    expect(paidChannelsTurnedOn({ orders: { SMS: true, WHATSAPP: false } }, before)).toEqual([]);
    expect(paidChannelsTurnedOn({ payments: { SMS: true } }, before)).toEqual(['SMS']);
    expect(paidChannelsTurnedOn({ unknown: { WHATSAPP: true } }, before)).toEqual([]);
    expect(paidChannelsTurnedOn({ orders: { WHATSAPP: true } })).toEqual(['WHATSAPP']);
  });
});
