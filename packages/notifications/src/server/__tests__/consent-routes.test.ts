/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   `db`, `api` and `sends` are rebuilt per case in `beforeEach`; the rule flags
   the module-scoped bindings they are assigned to, and the send recorder is
   what the assertions read. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiNotifications } from '../create-api-notifications';
import type { NotificationsResponse, NotificationsRoute } from '../context';

import {
  clinicConsent,
  consentOf,
  lastCode,
  mountContract,
  mutableContacts,
  phoneTransport,
  U1_E164,
  type ConsentStatus,
  type PhoneSend,
} from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 contract — the account endpoints.
 *
 * On `main` the preferences GET answers `{ preferences, availability,
 * categories }` and the PUT only saves (`routes.ts:194-218`): turning SMS or
 * WhatsApp on starts nothing, and there is no endpoint to resend a
 * confirmation or type a code.
 *
 * The contract:
 *  - GET (and PUT) also answer `consent`, per paid channel;
 *  - a PUT that turns a paid channel on for a number that is not confirmed
 *    starts its confirmation — ONE per number and channel, never one per
 *    category (an agent's switch and a person's start the same flow);
 *  - `POST /phone-confirmation/resend { channel }` and
 *    `POST /phone-confirmation/code { channel, code }`, answering the engine's
 *    status in `{ data }` (a cooldown is data the screen counts down, not an
 *    error); a malformed body is a 400.
 */

/** A fixed instant for receipts and replies whose time the case does not read. */
const AT = new Date('2026-11-16T15:00:00.000Z');

let db: MemoryDb;
let api: ApiNotifications;
let sends: PhoneSend[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-16T15:00:00.000Z'));
  db = createMemoryDb();
  sends = [];
  api = mountContract(db, {
    contacts: mutableContacts(),
    requireConsent: ['SMS', 'WHATSAPP'],
    consent: clinicConsent(),
  });
  api.transports.register(phoneTransport('SMS', sends));
  api.transports.register(phoneTransport('WHATSAPP', sends));
});

afterEach(() => {
  vi.useRealTimers();
});

function route(method: string, path: string): NotificationsRoute {
  const found = api.routes.find((entry) => entry.method === method && entry.path === path);
  if (!found) throw new Error(`FUT-285 contract: route ${method} ${path} is not implemented`);
  return found;
}

function call(method: string, path: string, body?: unknown, userId = 'u1'): Promise<NotificationsResponse> {
  return route(method, path).handle({
    actor: { userId },
    params: {},
    query: {},
    ...(body !== undefined ? { body } : {}),
  });
}

type ConsentPayload = Record<'SMS' | 'WHATSAPP', { status: ConsentStatus; method: string | null }>;

const data = <T,>(response: NotificationsResponse): T => (response.body as { data: T }).data;
const consentIn = (response: NotificationsResponse): ConsentPayload | undefined =>
  data<{ consent?: ConsentPayload }>(response).consent;

describe('GET /notification-preferences answers consent', () => {
  it('beside availability, per paid channel', async () => {
    const response = await call('GET', '/notification-preferences');
    expect(response.status).toBe(200);
    expect(consentIn(response)).toEqual({
      SMS: expect.objectContaining({ status: 'NONE' }),
      WHATSAPP: expect.objectContaining({ status: 'NONE' }),
    });
  });

  it('reflects a confirmation', async () => {
    await consentOf(api).request('u1', 'WHATSAPP');
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: AT, externalId: 'w' });
    expect(consentIn(await call('GET', '/notification-preferences'))?.WHATSAPP.status).toBe('CONFIRMED');
  });
});

describe('PUT /notification-preferences starts the confirmation', () => {
  it('turning WhatsApp on sends ONE reply prompt and answers PENDING', async () => {
    const response = await call('PUT', '/notification-preferences', { orders: { WHATSAPP: true } });
    expect(response.status).toBe(200);
    expect(consentIn(response)?.WHATSAPP).toMatchObject({ status: 'PENDING', method: 'REPLY' });
    expect(sends.map((send) => send.channel)).toEqual(['WHATSAPP']);
  });

  it('turning it on in a second category sends nothing more (one per number, not per category)', async () => {
    await call('PUT', '/notification-preferences', { orders: { WHATSAPP: true } });
    vi.setSystemTime(new Date('2026-11-16T15:05:00.000Z'));
    await call('PUT', '/notification-preferences', { payments: { WHATSAPP: true } });
    expect(sends).toHaveLength(1);
  });

  it('SMS and WhatsApp on in one save: each channel asked on its own', async () => {
    const response = await call('PUT', '/notification-preferences', { orders: { SMS: true, WHATSAPP: true } });
    expect(sends.map((send) => send.channel).sort()).toEqual(['SMS', 'WHATSAPP']);
    expect(consentIn(response)?.SMS).toMatchObject({ status: 'PENDING', method: 'CODE' });
  });

  it('a save that does not turn a paid channel on sends nothing', async () => {
    await call('PUT', '/notification-preferences', { orders: { EMAIL: false } });
    await call('PUT', '/notification-preferences', { orders: { SMS: false } });
    expect(sends).toEqual([]);
  });

  it('an already-confirmed channel is not asked again', async () => {
    await consentOf(api).request('u1', 'WHATSAPP');
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: AT, externalId: 'w' });
    vi.setSystemTime(new Date('2026-11-16T15:05:00.000Z'));
    await call('PUT', '/notification-preferences', { orders: { WHATSAPP: true } });
    expect(sends).toHaveLength(1);
  });

  it('no phone: the save still succeeds and nothing is sent', async () => {
    const response = await call('PUT', '/notification-preferences', { orders: { SMS: true } }, 'u-nophone');
    expect(response.status).toBe(200);
    expect(sends).toEqual([]);
  });
});

describe('POST /phone-confirmation/resend', () => {
  it('answers SENT after the cooldown, COOLDOWN with the time left inside it', async () => {
    await call('PUT', '/notification-preferences', { orders: { WHATSAPP: true } });
    vi.setSystemTime(new Date('2026-11-16T15:00:15.000Z'));
    const early = await call('POST', '/phone-confirmation/resend', { channel: 'WHATSAPP' });
    expect(early.status).toBe(200);
    expect(data(early)).toEqual({ status: 'COOLDOWN', retryAfterMs: 45_000 });

    vi.setSystemTime(new Date('2026-11-16T15:01:01.000Z'));
    expect(data(await call('POST', '/phone-confirmation/resend', { channel: 'WHATSAPP' }))).toMatchObject({ status: 'SENT' });
    expect(sends).toHaveLength(2);
  });

  it.each([{}, { channel: 'EMAIL' }, { channel: 'sms' }, null])('refuses %j with 400', async (body) => {
    expect((await call('POST', '/phone-confirmation/resend', body)).status).toBe(400);
  });
});

describe('POST /phone-confirmation/code', () => {
  it('the right code confirms SMS', async () => {
    await call('PUT', '/notification-preferences', { orders: { SMS: true } });
    const response = await call('POST', '/phone-confirmation/code', { channel: 'SMS', code: lastCode(sends, 'SMS') });
    expect(response.status).toBe(200);
    expect(data(response)).toEqual({ status: 'CONFIRMED' });
    expect((await consentOf(api).get('u1')).SMS.status).toBe('CONFIRMED');
  });

  it('a wrong code answers WRONG with the tries left', async () => {
    await call('PUT', '/notification-preferences', { orders: { SMS: true } });
    const wrong = lastCode(sends, 'SMS') === '000000' ? '111111' : '000000';
    expect(data(await call('POST', '/phone-confirmation/code', { channel: 'SMS', code: wrong }))).toEqual({
      status: 'WRONG',
      attemptsLeft: 4,
    });
  });

  it.each([
    { channel: 'SMS' },
    { channel: 'SMS', code: '12345' },
    { channel: 'SMS', code: '1234567' },
    { channel: 'SMS', code: '12a456' },
    { channel: 'PUSH', code: '123456' },
  ])('refuses %j with 400 (the code is exactly 6 digits)', async (body) => {
    expect((await call('POST', '/phone-confirmation/code', body)).status).toBe(400);
  });

  it('confirms only the caller: u3 (same number) stays pending', async () => {
    await call('PUT', '/notification-preferences', { orders: { SMS: true } }, 'u3');
    vi.setSystemTime(new Date('2026-11-16T15:02:00.000Z'));
    await call('PUT', '/notification-preferences', { orders: { SMS: true } }, 'u1');
    await call('POST', '/phone-confirmation/code', { channel: 'SMS', code: lastCode(sends, 'SMS') }, 'u1');
    expect((await consentOf(api).get('u3')).SMS.status).toBe('PENDING');
  });
});
