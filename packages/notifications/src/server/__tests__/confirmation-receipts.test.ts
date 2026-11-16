/* eslint-disable test-flakiness/no-global-state-mutation --
   the fetch doubles RECORD the requests they answer; each case builds its own. */
import { describe, expect, it } from 'vitest';

import type { ApiNotifications } from '../create-api-notifications';
import { confirmationOfWhatsAppStatus } from '../receipts';
import type { FetchImpl } from '../transports/drivers';
import { smsTransport } from '../transports/sms';
import { whatsAppTransport } from '../transports/whatsapp';
import { parseTwilioCallback } from '../twilio';

import { clinicConsent, consentOf, mountContract, mutableContacts } from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 review N5 — a CONFIRMATION message has no delivery row, so its
 * receipt used to answer `applied: false` for ever, which the host is told to
 * retry. Its callback now carries the consent row it was sent for, and its
 * receipt answers `{ applied: false, reason: 'not-tracked' }`: final. A
 * permanent failure on a grandfathered ASK — on its callback, or refused
 * synchronously — drops the grandfathering.
 */

const CALLBACK = 'https://host.example/hooks/twilio/status';
const AT = new Date('2026-11-16T15:00:00.000Z');

interface Recorded {
  fetchImpl: FetchImpl;
  forms: URLSearchParams[];
  json: Record<string, unknown>[];
}

function recording(answer: { ok: boolean; status: number; body: string }): Recorded {
  const forms: URLSearchParams[] = [];
  const json: Record<string, unknown>[] = [];
  return {
    forms,
    json,
    fetchImpl: (_url, init) => {
      const body = init?.body ?? '';
      if (body.startsWith('{')) json.push(JSON.parse(body) as Record<string, unknown>);
      else forms.push(new URLSearchParams(body));
      return Promise.resolve({ ok: answer.ok, status: answer.status, text: () => Promise.resolve(answer.body) });
    },
  };
}

const SENT = { ok: true, status: 201, body: '{"sid":"SM-ask-1","messages":[{"id":"wamid.ask-1"}]}' };

function mountSms(db: MemoryDb, fetchImpl: FetchImpl): ApiNotifications {
  const api = mountContract(db, { contacts: mutableContacts(), requireConsent: ['SMS'], consent: clinicConsent() });
  api.transports.register(
    smsTransport({
      channel: 'SMS',
      driver: 'twilio',
      accountSid: 'AC1',
      authToken: 't',
      from: '+15550001111',
      defaultCountryCode: '55',
      statusCallbackUrl: CALLBACK,
      fetchImpl,
    }),
  );
  return api;
}

const rowIdOf = (db: MemoryDb, channel: string): string => {
  const row = db.rows.consents.find((entry) => entry.userId === 'u1' && entry.channel === channel);
  if (!row) throw new Error('no consent row');
  return row.id;
};

describe('a confirmation message\'s receipt', () => {
  it('Twilio: the StatusCallback names the consent row, and the receipt is final (not-tracked)', async () => {
    const db = createMemoryDb();
    const twilio = recording(SENT);
    const api = mountSms(db, twilio.fetchImpl);
    expect((await consentOf(api).request('u1', 'SMS')).status).toBe('SENT');

    const url = twilio.forms[0]?.get('StatusCallback') ?? '';
    const rowId = rowIdOf(db, 'SMS');
    expect(new URL(url).searchParams.get('notificationsConfirmation')).toBe(rowId);

    const callback = parseTwilioCallback({ MessageSid: 'SM-ask-1', MessageStatus: 'delivered' }, { url });
    expect(callback).toMatchObject({ kind: 'status', confirmation: rowId });
    const outcome = await api.applyDeliveryReceipt({
      channel: 'SMS',
      providerMessageId: 'SM-ask-1',
      status: 'DELIVERED',
      at: AT,
      confirmation: callback.kind === 'status' ? (callback.confirmation ?? null) : null,
    });
    expect(outcome).toEqual({ applied: false, reason: 'not-tracked' });
  });

  it('a notification\'s own callback is untouched, and parses with no confirmation', () => {
    expect(parseTwilioCallback({ MessageSid: 'SM1', MessageStatus: 'delivered' }, { url: CALLBACK })).not.toHaveProperty(
      'confirmation',
    );
  });

  it('a PERMANENT failure on the grandfathered ask, on its callback, drops the grandfathering', async () => {
    const db = createMemoryDb();
    const twilio = recording(SENT);
    const api = mountSms(db, twilio.fetchImpl);
    await consentOf(api).grandfather([{ userId: 'u1', channel: 'SMS' }]);
    expect(await consentOf(api).askGrandfathered()).toEqual({ asked: 1 });
    const callback = parseTwilioCallback(
      { MessageSid: 'SM-ask-1', MessageStatus: 'undelivered', ErrorCode: '30005' },
      { url: twilio.forms[0]?.get('StatusCallback') ?? '' },
    );
    if (callback.kind !== 'status') throw new Error('not a status');
    await api.applyDeliveryReceipt({
      channel: 'SMS',
      providerMessageId: callback.providerMessageId,
      status: callback.status,
      at: AT,
      permanent: callback.permanent,
      confirmation: callback.confirmation ?? null,
    });
    expect((await consentOf(api).get('u1')).SMS.status).toBe('NONE');
  });

  it('a TRANSIENT failure on it keeps the grandfathering', async () => {
    const db = createMemoryDb();
    const api = mountSms(db, recording(SENT).fetchImpl);
    await consentOf(api).grandfather([{ userId: 'u1', channel: 'SMS' }]);
    await consentOf(api).askGrandfathered();
    await api.applyDeliveryReceipt({
      channel: 'SMS',
      providerMessageId: 'SM-ask-1',
      status: 'UNDELIVERED',
      at: AT,
      permanent: false,
      confirmation: rowIdOf(db, 'SMS'),
    });
    expect((await consentOf(api).get('u1')).SMS.status).toBe('GRANDFATHERED');
  });

  it('WhatsApp (Meta): the message carries biz_opaque_callback_data naming the consent row', async () => {
    const db = createMemoryDb();
    const meta = recording(SENT);
    const api = mountContract(db, { contacts: mutableContacts(), requireConsent: ['WHATSAPP'], consent: clinicConsent() });
    api.transports.register(
      whatsAppTransport({
        channel: 'WHATSAPP',
        driver: 'meta',
        accessToken: 'token',
        phoneNumberId: '1065',
        templateName: 'generic_alert',
        templateLanguage: 'pt_BR',
        defaultCountryCode: '55',
        fetchImpl: meta.fetchImpl,
      }),
    );
    await consentOf(api).request('u1', 'WHATSAPP');
    const tag = meta.json[0]?.biz_opaque_callback_data as string;
    expect(confirmationOfWhatsAppStatus(tag)).toBe(rowIdOf(db, 'WHATSAPP'));
    expect(confirmationOfWhatsAppStatus('something-else')).toBeNull();
    expect(confirmationOfWhatsAppStatus(undefined)).toBeNull();
  });
});

describe('a grandfathered ask refused SYNCHRONOUSLY', () => {
  it.each([
    ['21614', 'NONE'],
    ['21211', 'NONE'],
    ['21610', 'OPTED_OUT'],
  ])('Twilio %s ends the grandfathering (%s)', async (code, status) => {
    const db = createMemoryDb();
    const api = mountSms(db, recording({ ok: false, status: 400, body: `{"code":${code}}` }).fetchImpl);
    await consentOf(api).grandfather([{ userId: 'u1', channel: 'SMS' }]);
    expect(await consentOf(api).askGrandfathered()).toEqual({ asked: 0 });
    expect((await consentOf(api).get('u1')).SMS.status).toBe(status);
  });

  it('a transient refusal releases the claim for the next run', async () => {
    const db = createMemoryDb();
    const api = mountSms(db, recording({ ok: false, status: 503, body: 'busy' }).fetchImpl);
    await consentOf(api).grandfather([{ userId: 'u1', channel: 'SMS' }]);
    await consentOf(api).askGrandfathered();
    expect((await consentOf(api).get('u1')).SMS.status).toBe('GRANDFATHERED');
    expect(db.rows.consents[0]?.askedAt).toBeNull();
  });
});
