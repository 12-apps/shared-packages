/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   `db`, `sends`, `emails`, `asked` and `contacts` are rebuilt per case in
   `beforeEach`; the rule flags the module-scoped bindings they are assigned to,
   and the recorders are what the assertions read. A case that changes a phone
   changes its own fresh copy of the roster. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApiNotifications } from '../create-api-notifications';

import {
  clinicConfirmation,
  clinicConsent,
  consentOf,
  deliveriesOf,
  emailTransport,
  lastCode,
  mountContract,
  mutableContacts,
  phoneTransport,
  U1_E164,
  type ConfirmationMessageInput,
  type ContractConfig,
  type PaidChannel,
  type PhoneSend,
} from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 contract — the confirmed-destination engine.
 *
 * On `main` there is no consent at all: a phone is "verified" when it
 * normalizes (`phone.ts:19-22`, `transports/drivers.ts:134-140`), so an SMS or
 * WhatsApp switch turned on is a billed message on the next emit, a SAIR
 * reaches nobody, and a retry sends whatever is QUEUED.
 *
 * The owner's decisions (2026-11-16) this pins:
 *  - SMS cannot receive replies: it confirms with a 6-digit code (10 min, 5
 *    tries). WhatsApp confirms by a reply (typed SIM or the reply button).
 *  - EACH CHANNEL IS CONFIRMED ON ITS OWN; SAIR turns off the channel it
 *    arrived on, for every account on that number.
 *  - Reenviar: 60 s cooldown, at most 3 sends a day (the first included).
 *  - Grandfathered phones keep receiving and are asked ONCE.
 *  - The confirmation may carry the account's first name (host copy).
 *  - Keywords and copy are the host's.
 *  - `requireConsent` gates at creation AND before every send, retries
 *    included, so nothing goes out after SAIR.
 */

const T0 = new Date('2026-11-16T15:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

let db: MemoryDb;
let sends: PhoneSend[];
let emails: string[];
let asked: ConfirmationMessageInput[];
let contacts: ReturnType<typeof mutableContacts>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock.at = T0;
  vi.setSystemTime(T0);
  db = createMemoryDb();
  sends = [];
  emails = [];
  asked = [];
  contacts = mutableContacts();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The suite's clock: every "now" a case reads, moved only by `advance`. */
const clock = { at: T0 };

const advance = (ms: number): void => {
  clock.at = new Date(clock.at.getTime() + ms);
  vi.setSystemTime(clock.at);
};

function mount(extra: Partial<ContractConfig> = {}): ApiNotifications {
  const api = mountContract(db, {
    contacts,
    requireConsent: ['SMS', 'WHATSAPP'],
    consent: clinicConsent({
      message: (input) => {
        asked.push(input);
        return clinicConfirmation(input);
      },
    }),
    ...extra,
  });
  api.transports.register(emailTransport(emails));
  api.transports.register(phoneTransport('SMS', sends));
  api.transports.register(phoneTransport('WHATSAPP', sends));
  return api;
}

/** Turn the paid channels on for `orders` (preferences only — no consent). */
async function enable(api: ApiNotifications, userId: string, ...channels: PaidChannel[]): Promise<void> {
  await api.preferences.save(userId, {
    orders: Object.fromEntries(channels.map((channel) => [channel, true])),
  });
}

function emit(api: ApiNotifications, userId: string, code = 'A1') {
  return api.notify({ type: 'order.paid', recipient: { userId }, payload: { code } }, { sync: true });
}

const sentOn = (channel: PaidChannel): PhoneSend[] => sends.filter((send) => send.channel === channel);

/** Confirm u1's WhatsApp by a SIM reply. */
async function confirmWhatsApp(api: ApiNotifications, userId = 'u1'): Promise<void> {
  await consentOf(api).request(userId, 'WHATSAPP');
  await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: clock.at, externalId: `wamid.sim-${userId}` });
}

describe('mount validation', () => {
  it('refuses requireConsent on a channel with no confirmation method', () => {
    expect(() =>
      mountContract(db, {
        requireConsent: ['SMS', 'WHATSAPP'],
        consent: clinicConsent({ methods: { WHATSAPP: 'REPLY' } }),
      }),
    ).toThrow(/SMS/);
  });

  it('refuses requireConsent with no host keywords (the package ships no words)', () => {
    expect(() =>
      mountContract(db, {
        requireConsent: ['WHATSAPP'],
        consent: clinicConsent({ confirmKeywords: [] }),
      }),
    ).toThrow(/keyword/i);
    expect(() =>
      mountContract(db, {
        requireConsent: ['WHATSAPP'],
        consent: clinicConsent({ optOutKeywords: [] }),
      }),
    ).toThrow(/keyword/i);
  });
});

describe('request — one confirmation for the number', () => {
  it('WhatsApp: sends ONE reply prompt through the WhatsApp transport, built by the host with the first name', async () => {
    const api = mount();
    const result = await consentOf(api).request('u1', 'WHATSAPP');

    expect(result).toEqual({ status: 'SENT', retryAfterMs: 60 * SECOND });
    expect(sentOn('WHATSAPP')).toEqual([
      expect.objectContaining({ userId: 'u1', text: expect.stringContaining('Ana, quer receber') }),
    ]);
    expect(sentOn('SMS')).toEqual([]);
    expect(asked).toEqual([
      expect.objectContaining({ channel: 'WHATSAPP', method: 'REPLY', firstName: 'Ana', reason: 'REQUEST' }),
    ]);
    const consent = await consentOf(api).get('u1');
    expect(consent.WHATSAPP).toMatchObject({ status: 'PENDING', method: 'REPLY', destination: U1_E164 });
    // Each channel on its own: asking for WhatsApp leaves SMS untouched.
    expect(consent.SMS.status).toBe('NONE');
  });

  it('SMS: sends a 6-digit code through the SMS transport and never stores it in clear', async () => {
    const api = mount();
    expect((await consentOf(api).request('u1', 'SMS')).status).toBe('SENT');

    const code = lastCode(sends, 'SMS');
    expect(code).toMatch(/^\d{6}$/);
    expect(asked[0]).toMatchObject({ channel: 'SMS', method: 'CODE', code, reason: 'REQUEST' });
    const consent = await consentOf(api).get('u1');
    expect(consent.SMS).toMatchObject({ status: 'PENDING', method: 'CODE', destination: U1_E164 });
    // The consent row is in the database (its destination is), the code is not.
    const stored = JSON.stringify(db.rows);
    expect(stored).toContain(U1_E164);
    expect(stored).not.toContain(code);
  });

  it('no phone on file: NO_PHONE, nothing sent, no row', async () => {
    const api = mount();
    expect(await consentOf(api).request('u-nophone', 'WHATSAPP')).toMatchObject({ status: 'NO_PHONE' });
    expect(sends).toEqual([]);
    expect((await consentOf(api).get('u-nophone')).WHATSAPP.status).toBe('NONE');
  });

  it('an already-confirmed channel is not asked again', async () => {
    const api = mount();
    await confirmWhatsApp(api);
    advance(2 * MINUTE);
    expect(await consentOf(api).request('u1', 'WHATSAPP')).toMatchObject({ status: 'ALREADY_CONFIRMED' });
    expect(sentOn('WHATSAPP')).toHaveLength(1);
  });
});

describe('resend — 60 s cooldown, at most 3 sends a day', () => {
  it('inside the cooldown: COOLDOWN with the time left, nothing sent', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    advance(20 * SECOND);
    expect(await consentOf(api).resend('u1', 'WHATSAPP')).toEqual({ status: 'COOLDOWN', retryAfterMs: 40 * SECOND });
    expect(sentOn('WHATSAPP')).toHaveLength(1);
  });

  it('after the cooldown it sends, with reason RESEND', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    advance(61 * SECOND);
    expect((await consentOf(api).resend('u1', 'WHATSAPP')).status).toBe('SENT');
    expect(sentOn('WHATSAPP')).toHaveLength(2);
    expect(asked[1]).toMatchObject({ reason: 'RESEND' });
  });

  it('the fourth send of a day is DAILY_LIMIT; two days later it sends again', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    advance(61 * SECOND);
    await consentOf(api).resend('u1', 'WHATSAPP');
    advance(61 * SECOND);
    await consentOf(api).resend('u1', 'WHATSAPP');
    advance(61 * SECOND);
    expect((await consentOf(api).resend('u1', 'WHATSAPP')).status).toBe('DAILY_LIMIT');
    expect(sentOn('WHATSAPP')).toHaveLength(3);

    advance(2 * DAY);
    expect((await consentOf(api).resend('u1', 'WHATSAPP')).status).toBe('SENT');
    expect(sentOn('WHATSAPP')).toHaveLength(4);
  });

  it('the cooldown holds under concurrency: five parallel taps send once', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    advance(61 * SECOND);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consentOf(api).resend('u1', 'WHATSAPP')),
    );
    expect(results.filter((result) => result.status === 'SENT')).toHaveLength(1);
    expect(sentOn('WHATSAPP')).toHaveLength(2);
  });

  it('a resent SMS code replaces the old one', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'SMS');
    const first = lastCode(sends, 'SMS');
    advance(61 * SECOND);
    await consentOf(api).resend('u1', 'SMS');
    const second = lastCode(sends, 'SMS');
    if (first === second) return; // one-in-a-million collision: nothing to prove
    expect((await consentOf(api).confirmCode('u1', 'SMS', first)).status).toBe('WRONG');
    expect((await consentOf(api).confirmCode('u1', 'SMS', second)).status).toBe('CONFIRMED');
  });
});

describe('confirmCode — 6 digits, 10 minutes, 5 tries', () => {
  it('the right code confirms SMS, and only SMS', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'SMS');
    advance(9 * MINUTE + 59 * SECOND);
    expect(await consentOf(api).confirmCode('u1', 'SMS', lastCode(sends, 'SMS'))).toEqual({ status: 'CONFIRMED' });
    const consent = await consentOf(api).get('u1');
    expect(consent.SMS).toMatchObject({ status: 'CONFIRMED', method: 'CODE', destination: U1_E164 });
    expect(consent.SMS.confirmedAt).toEqual(clock.at);
    expect(consent.WHATSAPP.status).toBe('NONE');
  });

  it('a wrong code says how many tries are left', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'SMS');
    const wrong = lastCode(sends, 'SMS') === '000000' ? '111111' : '000000';
    expect(await consentOf(api).confirmCode('u1', 'SMS', wrong)).toEqual({ status: 'WRONG', attemptsLeft: 4 });
    expect((await consentOf(api).get('u1')).SMS.status).toBe('PENDING');
  });

  it('after 5 wrong codes even the right one is refused until a new code is sent', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'SMS');
    const right = lastCode(sends, 'SMS');
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) await consentOf(api).confirmCode('u1', 'SMS', wrong);
    expect((await consentOf(api).confirmCode('u1', 'SMS', right)).status).toBe('TOO_MANY_ATTEMPTS');
    expect((await consentOf(api).get('u1')).SMS.status).toBe('PENDING');
  });

  it('the tries are counted atomically: 20 parallel wrong guesses still lock the code', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'SMS');
    const right = lastCode(sends, 'SMS');
    const wrong = right === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 20 }, () => consentOf(api).confirmCode('u1', 'SMS', wrong)));
    expect((await consentOf(api).confirmCode('u1', 'SMS', right)).status).toBe('TOO_MANY_ATTEMPTS');
  });

  it('a code older than 10 minutes is EXPIRED', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'SMS');
    advance(10 * MINUTE + SECOND);
    expect((await consentOf(api).confirmCode('u1', 'SMS', lastCode(sends, 'SMS'))).status).toBe('EXPIRED');
    expect((await consentOf(api).get('u1')).SMS.status).toBe('PENDING');
  });

  it('a reply channel has no code to confirm', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    expect((await consentOf(api).confirmCode('u1', 'WHATSAPP', '123456')).status).toBe('NO_PENDING');
  });
});

describe('applyInbound — SIM confirms the channel it arrived on', () => {
  it('confirms every account pending on that number, and keeps the consent record', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    await consentOf(api).request('u3', 'WHATSAPP'); // the same number, another account
    const at = new Date('2026-11-16T15:03:00.000Z');

    // Meta reports the sender as bare digits.
    const result = await consentOf(api).applyInbound({
      channel: 'WHATSAPP',
      from: '5511987654321',
      text: 'Sim!',
      at,
      externalId: 'wamid.SIM-1',
    });

    expect(result.outcome).toBe('CONFIRMED');
    expect([...result.userIds].sort()).toEqual(['u1', 'u3']);
    for (const userId of ['u1', 'u3']) {
      const view = (await consentOf(api).get(userId)).WHATSAPP;
      expect(view).toMatchObject({ status: 'CONFIRMED', method: 'REPLY', destination: U1_E164, confirmedAt: at });
      expect(view.record).toEqual({ text: 'Sim!', externalId: 'wamid.SIM-1', at });
    }
  });

  it.each(['sim', '  SIM  ', 'Sím.', 'SIM 👍'])('the whole text %j is a SIM', async (text) => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    const result = await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text, at: clock.at, externalId: 'wamid.x' });
    expect(result.outcome).toBe('CONFIRMED');
  });

  it.each(['sim, quero', 'sim mas depois', 'simone'])('%j is not a SIM: the request stays pending', async (text) => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    const result = await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text, at: clock.at, externalId: 'wamid.x' });
    expect(result).toEqual({ outcome: 'IGNORED', userIds: [] });
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('PENDING');
  });

  it('the host words are the words: a SIM on a mount whose confirm keyword is YES is ignored', async () => {
    const api = mount({ consent: clinicConsent({ confirmKeywords: ['YES'] }) });
    await consentOf(api).request('u1', 'WHATSAPP');
    expect((await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: clock.at, externalId: 'w1' })).outcome).toBe('IGNORED');
    expect((await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'yes', at: clock.at, externalId: 'w2' })).outcome).toBe('CONFIRMED');
  });

  it('a WhatsApp SIM never confirms SMS', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'SMS');
    await confirmWhatsApp(api);
    const consent = await consentOf(api).get('u1');
    expect(consent.WHATSAPP.status).toBe('CONFIRMED');
    expect(consent.SMS.status).toBe('PENDING');
  });

  it('a SIM nobody asked for creates nothing', async () => {
    const api = mount();
    const result = await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: clock.at, externalId: 'w' });
    expect(result).toEqual({ outcome: 'IGNORED', userIds: [] });
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('NONE');
  });

  it('a SIM from another number confirms nobody here', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: '+5531999998888', text: 'SIM', at: clock.at, externalId: 'w' });
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('PENDING');
  });

  it('a SIM upgrades a grandfathered phone to confirmed', async () => {
    const api = mount();
    await enable(api, 'u1', 'WHATSAPP');
    await consentOf(api).grandfather([{ userId: 'u1', channel: 'WHATSAPP' }]);
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: clock.at, externalId: 'w' });
    expect((await consentOf(api).get('u1')).WHATSAPP).toMatchObject({ status: 'CONFIRMED', method: 'REPLY' });
  });
});

describe('applyInbound — SAIR turns off the channel it arrived on', () => {
  it('opts out every account on that number, from any state, and leaves SMS alone', async () => {
    const api = mount();
    await confirmWhatsApp(api); // u1 CONFIRMED
    await consentOf(api).request('u3', 'WHATSAPP'); // u3 PENDING, same number
    await consentOf(api).request('u1', 'SMS');
    await consentOf(api).confirmCode('u1', 'SMS', lastCode(sends, 'SMS'));
    const at = new Date('2026-11-16T15:30:00.000Z');

    const result = await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SAIR', at, externalId: 'wamid.OUT' });

    expect(result.outcome).toBe('OPTED_OUT');
    expect([...result.userIds].sort()).toEqual(['u1', 'u3']);
    const u1 = await consentOf(api).get('u1');
    expect(u1.WHATSAPP).toMatchObject({ status: 'OPTED_OUT', optedOutAt: at });
    expect(u1.SMS.status).toBe('CONFIRMED');
    expect((await consentOf(api).get('u3')).WHATSAPP.status).toBe('OPTED_OUT');
  });

  it.each(['sair', 'Parar.', 'STOP', 'cancelar!'])('%j opts out', async (text) => {
    const api = mount();
    await confirmWhatsApp(api);
    expect((await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text, at: clock.at, externalId: 'w' })).outcome).toBe('OPTED_OUT');
  });

  it('"sair do grupo" is a sentence, not a keyword: nothing changes', async () => {
    const api = mount();
    await confirmWhatsApp(api);
    expect((await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'sair do grupo', at: clock.at, externalId: 'w' })).outcome).toBe('IGNORED');
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('CONFIRMED');
  });

  it("a provider's own stop signal opts out like a keyword", async () => {
    const api = mount();
    await confirmWhatsApp(api);
    const result = await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, optOut: true, at: clock.at, externalId: 'pref-stop' });
    expect(result.outcome).toBe('OPTED_OUT');
  });

  it('a late SIM older than the SAIR never re-confirms', async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    const simAt = new Date(clock.at.getTime() + MINUTE);
    const sairAt = new Date(clock.at.getTime() + 2 * MINUTE);
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SAIR', at: sairAt, externalId: 'w-out' });
    const late = await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: simAt, externalId: 'w-sim' });
    expect(late.outcome).toBe('IGNORED');
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('OPTED_OUT');
  });

  it('a SIM after SAIR, with no new request, is ignored; turning it on again asks again', async () => {
    const api = mount();
    await confirmWhatsApp(api);
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SAIR', at: clock.at, externalId: 'w-out' });
    advance(MINUTE);
    expect((await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: clock.at, externalId: 'w-again' })).outcome).toBe('IGNORED');

    advance(2 * MINUTE);
    expect((await consentOf(api).request('u1', 'WHATSAPP')).status).toBe('SENT');
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('PENDING');
  });
});

describe('the gate at creation — requireConsent', () => {
  it('NONE and PENDING: no paid delivery row; the inbox and e-mail are untouched', async () => {
    const api = mount();
    await enable(api, 'u1', 'SMS', 'WHATSAPP');
    const none = await emit(api, 'u1', 'N1');
    await consentOf(api).request('u1', 'WHATSAPP');
    sends.length = 0;
    const pending = await emit(api, 'u1', 'N2');

    for (const result of [none, pending]) {
      expect(result.channels).toEqual(['EMAIL']);
      expect(deliveriesOf(db, result.notificationId).map((row) => row.channel)).toEqual(['EMAIL']);
    }
    expect(sends).toEqual([]);
    expect(db.rows.notifications).toHaveLength(2);
    expect(emails).toEqual(['u1', 'u1']);
  });

  it('CONFIRMED on WhatsApp sends WhatsApp and still not SMS', async () => {
    const api = mount();
    await enable(api, 'u1', 'SMS', 'WHATSAPP');
    await confirmWhatsApp(api);
    sends.length = 0;
    const result = await emit(api, 'u1');
    expect(result.channels).toEqual(['EMAIL', 'WHATSAPP']);
    expect(sends.map((send) => send.channel)).toEqual(['WHATSAPP']);
  });

  it('GRANDFATHERED keeps receiving', async () => {
    const api = mount();
    await enable(api, 'u1', 'SMS');
    await consentOf(api).grandfather([{ userId: 'u1', channel: 'SMS' }]);
    expect((await emit(api, 'u1')).channels).toContain('SMS');
  });

  it('consent belongs to the NUMBER: a changed phone is not confirmed even if nobody called forgetDestination', async () => {
    const api = mount();
    await enable(api, 'u1', 'WHATSAPP');
    await confirmWhatsApp(api);
    const person = contacts.people.u1;
    if (!person) throw new Error('fixture');
    person.phone = '+5521911112222';
    sends.length = 0;
    expect((await emit(api, 'u1')).channels).not.toContain('WHATSAPP');
    expect(sends).toEqual([]);
  });

  it('only the channels named in requireConsent are gated', async () => {
    const api = mount({ requireConsent: ['WHATSAPP'] });
    await enable(api, 'u1', 'SMS', 'WHATSAPP');
    const result = await emit(api, 'u1');
    expect(result.channels).toEqual(['EMAIL', 'SMS']);
  });

  it('without requireConsent nothing changes for an adopter (today\'s behaviour)', async () => {
    const api = mount({ requireConsent: [] });
    await enable(api, 'u1', 'SMS', 'WHATSAPP');
    expect((await emit(api, 'u1')).channels).toEqual(['EMAIL', 'SMS', 'WHATSAPP']);
  });
});

describe('the gate before every send — nothing goes out after SAIR', () => {
  it('a QUEUED delivery created while confirmed is not sent once SAIR arrives; the row is DEAD', async () => {
    const api = mount({ scheduleDispatch: () => Promise.resolve() });
    await enable(api, 'u1', 'WHATSAPP');
    await confirmWhatsApp(api);
    sends.length = 0;
    const { notificationId, channels } = await api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'Q1' } });
    expect(channels).toContain('WHATSAPP');

    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SAIR', at: clock.at, externalId: 'w-out' });
    await api.dispatchDeliveries(notificationId);

    expect(sentOn('WHATSAPP')).toEqual([]);
    const row = deliveriesOf(db, notificationId).find((entry) => entry.channel === 'WHATSAPP');
    expect(row?.status).toBe('DEAD');
    // The free channel of the same notification is still delivered.
    expect(emails).toEqual(['u1']);
  });

  it('a FAILED delivery is not retried by the sweep after SAIR', async () => {
    let down = true;
    const api = mountContract(db, {
      contacts,
      requireConsent: ['SMS', 'WHATSAPP'],
      consent: clinicConsent(),
    });
    api.transports.register(phoneTransport('WHATSAPP', sends, { fail: () => down }));
    await enable(api, 'u1', 'WHATSAPP');
    down = false;
    await confirmWhatsApp(api);
    sends.length = 0;
    down = true;
    const { notificationId } = await emit(api, 'u1', 'F1');
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('FAILED');

    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'PARAR', at: clock.at, externalId: 'w-out' });
    down = false;
    for (const row of db.rows.deliveries) row.updatedAt = new Date(row.updatedAt.getTime() - 60 * MINUTE);
    await api.drainPending(0);

    expect(sends).toEqual([]);
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DEAD');
  });

  it('a phone changed between creation and dispatch is not sent to', async () => {
    const api = mount({ scheduleDispatch: () => Promise.resolve() });
    await enable(api, 'u1', 'WHATSAPP');
    await confirmWhatsApp(api);
    sends.length = 0;
    const { notificationId } = await api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code: 'Q2' } });
    const person = contacts.people.u1;
    if (!person) throw new Error('fixture');
    person.phone = '+5521911112222';
    await consentOf(api).forgetDestination('u1');
    await api.dispatchDeliveries(notificationId);
    expect(sends).toEqual([]);
  });
});

describe('forgetDestination — a phone change forgets', () => {
  it('drops confirmed, pending and grandfathered rows alike; a new request goes to the new number', async () => {
    const api = mount();
    await enable(api, 'u1', 'SMS', 'WHATSAPP');
    await confirmWhatsApp(api);
    await consentOf(api).grandfather([{ userId: 'u1', channel: 'SMS' }]);

    const person = contacts.people.u1;
    if (!person) throw new Error('fixture');
    person.phone = '+5521911112222';
    await consentOf(api).forgetDestination('u1');

    const consent = await consentOf(api).get('u1');
    expect(consent.SMS.status).toBe('NONE');
    expect(consent.WHATSAPP.status).toBe('NONE');
    sends.length = 0;
    expect((await emit(api, 'u1')).channels).toEqual(['EMAIL']);

    advance(2 * MINUTE);
    await consentOf(api).request('u1', 'WHATSAPP');
    expect((await consentOf(api).get('u1')).WHATSAPP.destination).toBe('+5521911112222');
  });

  it("forgetting u1 leaves u3's consent on the same number alone", async () => {
    const api = mount();
    await consentOf(api).request('u1', 'WHATSAPP');
    await consentOf(api).request('u3', 'WHATSAPP');
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SIM', at: clock.at, externalId: 'w' });
    await consentOf(api).forgetDestination('u1');
    expect((await consentOf(api).get('u3')).WHATSAPP.status).toBe('CONFIRMED');
  });
});

describe('grandfather — keep receiving, asked once', () => {
  it('creates GRANDFATHERED rows for the current number, skips a missing phone, never downgrades', async () => {
    const api = mount();
    await confirmWhatsApp(api); // u1 WhatsApp already CONFIRMED
    const result = await consentOf(api).grandfather([
      { userId: 'u1', channel: 'WHATSAPP' },
      { userId: 'u1', channel: 'SMS' },
      { userId: 'u2', channel: 'SMS' },
      { userId: 'u-nophone', channel: 'SMS' },
    ]);
    expect(result).toEqual({ created: 2 });
    const u1 = await consentOf(api).get('u1');
    expect(u1.WHATSAPP.status).toBe('CONFIRMED');
    expect(u1.SMS).toMatchObject({ status: 'GRANDFATHERED', method: 'GRANDFATHERED', destination: U1_E164 });
    expect((await consentOf(api).get('u2')).SMS).toMatchObject({ status: 'GRANDFATHERED', destination: '+5531999998888' });
    expect((await consentOf(api).get('u-nophone')).SMS.status).toBe('NONE');
  });

  it('never resurrects an opt-out', async () => {
    const api = mount();
    await confirmWhatsApp(api);
    await consentOf(api).applyInbound({ channel: 'WHATSAPP', from: U1_E164, text: 'SAIR', at: clock.at, externalId: 'w-out' });
    expect(await consentOf(api).grandfather([{ userId: 'u1', channel: 'WHATSAPP' }])).toEqual({ created: 0 });
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('OPTED_OUT');
  });

  it('askGrandfathered sends ONE confirmation per grandfathered row, ever — even when two runs overlap', async () => {
    const api = mount();
    await consentOf(api).grandfather([
      { userId: 'u1', channel: 'WHATSAPP' },
      { userId: 'u2', channel: 'WHATSAPP' },
    ]);
    const [first, second] = await Promise.all([
      consentOf(api).askGrandfathered(),
      consentOf(api).askGrandfathered(),
    ]);
    expect((first?.asked ?? 0) + (second?.asked ?? 0)).toBe(2);
    expect((await consentOf(api).askGrandfathered()).asked).toBe(0);

    expect(sentOn('WHATSAPP').map((send) => send.userId).sort()).toEqual(['u1', 'u2']);
    expect(asked.every((input) => input.reason === 'GRANDFATHERED')).toBe(true);
    // Asking changes nothing about receiving: still grandfathered until SIM or SAIR.
    expect((await consentOf(api).get('u1')).WHATSAPP.status).toBe('GRANDFATHERED');
  });

  it('askGrandfathered is bounded by take', async () => {
    const api = mount();
    await consentOf(api).grandfather([
      { userId: 'u1', channel: 'WHATSAPP' },
      { userId: 'u2', channel: 'WHATSAPP' },
    ]);
    expect((await consentOf(api).askGrandfathered({ take: 1 })).asked).toBe(1);
    expect((await consentOf(api).askGrandfathered({ take: 1 })).asked).toBe(1);
    expect((await consentOf(api).askGrandfathered({ take: 1 })).asked).toBe(0);
  });
});
