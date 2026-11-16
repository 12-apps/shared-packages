/* eslint-disable test-flakiness/no-test-isolation, test-flakiness/no-global-state-mutation --
   every `api`, `db`, `sends` and double is a LOCAL of its own case (the isolation
   rule reads a name reused across cases as shared state);
   the fetch double COUNTS the provider calls it answers; each case builds its own. */
import { describe, expect, it } from 'vitest';

import type { ApiNotifications } from '../create-api-notifications';
import { NotificationProviderError, type FetchImpl } from '../transports/drivers';
import { smsTransport } from '../transports/sms';
import { twilioRejectionOf } from '../twilio';

import { clinicConsent, consentOf, deliveriesOf, mountContract, U1_E164 } from './consent-contract';
import { createMemoryDb, type MemoryDb } from './memory-db';

/**
 * FUT-285 review B1 — Twilio refuses a bad number SYNCHRONOUSLY: the message
 * create answers HTTP 400 with its REST code (21211 invalid 'To', 21614 not a
 * mobile number, 21610 the recipient replied STOP). Those never reach a status
 * callback, so the dispatcher classifies them itself: the row is DEAD at once,
 * a grandfathering of the number is dropped, and a provider-held STOP is an
 * opt-out. The first case is the reviewer's reproduction, landed as it failed.
 */

function twilioAnswering(status: number, body: string): { fetchImpl: FetchImpl; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    fetchImpl: () => {
      calls += 1;
      return Promise.resolve({ ok: false, status, text: () => Promise.resolve(body) });
    },
  };
}

async function grandfatheredSms(db: MemoryDb, fetchImpl: FetchImpl): Promise<ApiNotifications> {
  const api = mountContract(db, { requireConsent: ['SMS', 'WHATSAPP'], consent: clinicConsent() });
  api.transports.register(
    smsTransport({ channel: 'SMS', driver: 'twilio', accountSid: 'AC1', authToken: 't', from: '+15550001111', defaultCountryCode: '55', fetchImpl }),
  );
  await api.preferences.save('u1', { orders: { EMAIL: false, WEB_PUSH: false, SMS: true } });
  await consentOf(api).grandfather([{ userId: 'u1', channel: 'SMS' }]);
  return api;
}

const emit = (api: ApiNotifications, code: string) =>
  api.notify({ type: 'order.paid', recipient: { userId: 'u1' }, payload: { code } }, { sync: true });

describe('a SYNCHRONOUS permanent Twilio error on a grandfathered phone', () => {
  it('stops sends to it (owner rule) — Twilio rejects To=landline with HTTP 400 code 21614', async () => {
    const db = createMemoryDb();
    const twilio = twilioAnswering(400, '{"code":21614,"message":"\'To\' number is not a valid mobile number"}');
    const api = await grandfatheredSms(db, twilio.fetchImpl);
    await emit(api, 'A');
    const second = await emit(api, 'B');
    expect(second.channels).not.toContain('SMS');
    expect((await consentOf(api).get('u1')).SMS.status).toBe('NONE');
    expect(twilio.calls()).toBe(1);
  });

  it.each(['21211', '21614'])('%s: the row is DEAD after ONE call, and the sweep never sends it again', async (code) => {
    const db = createMemoryDb();
    const twilio = twilioAnswering(400, `{"code":${code},"message":"bad number"}`);
    const api = await grandfatheredSms(db, twilio.fetchImpl);
    const { notificationId } = await emit(api, 'A');
    const [row] = deliveriesOf(db, notificationId);
    expect(row).toMatchObject({ channel: 'SMS', status: 'DEAD', attempts: 1 });
    for (const entry of db.rows.deliveries) entry.updatedAt = new Date(entry.updatedAt.getTime() - 60 * 60_000);
    await api.drainPending(0);
    expect(twilio.calls()).toBe(1);
  });

  it('21610 (the person replied STOP to Twilio) records an OPT-OUT', async () => {
    const db = createMemoryDb();
    const twilio = twilioAnswering(400, '{"code":21610,"message":"Attempt to send to unsubscribed recipient"}');
    const api = await grandfatheredSms(db, twilio.fetchImpl);
    const { notificationId } = await emit(api, 'A');
    expect(deliveriesOf(db, notificationId)[0]?.status).toBe('DEAD');
    expect((await consentOf(api).get('u1')).SMS).toMatchObject({ status: 'OPTED_OUT', destination: U1_E164 });
    expect((await emit(api, 'B')).channels).not.toContain('SMS');
    expect(twilio.calls()).toBe(1);
  });

  it('a transient refusal (HTTP 500, or a 400 with another code) keeps the ordinary retry and the grandfathering', async () => {
    for (const [status, body] of [[500, 'upstream down'], [400, '{"code":20003}']] as const) {
      const db = createMemoryDb();
      const twilio = twilioAnswering(status, body);
      const api = await grandfatheredSms(db, twilio.fetchImpl);
      const { notificationId } = await emit(api, 'A');
      expect(deliveriesOf(db, notificationId)[0]?.status).toBe('FAILED');
      expect((await consentOf(api).get('u1')).SMS.status).toBe('GRANDFATHERED');
    }
  });
});

describe('twilioRejectionOf', () => {
  it('reads the code of a Twilio REST error body, and nothing else', () => {
    expect(twilioRejectionOf(new NotificationProviderError('Twilio', 400, '{"code":21211}'))).toBe('BAD_NUMBER');
    expect(twilioRejectionOf(new NotificationProviderError('Twilio', 400, '{"code":"21614"}'))).toBe('BAD_NUMBER');
    expect(twilioRejectionOf(new NotificationProviderError('Twilio', 400, '{"code":21610}'))).toBe('OPTED_OUT');
    expect(twilioRejectionOf(new NotificationProviderError('Twilio', 400, '{"code":30005}'))).toBeNull();
    expect(twilioRejectionOf(new NotificationProviderError('Twilio', 400, 'not json'))).toBeNull();
    expect(twilioRejectionOf(new NotificationProviderError('Resend', 400, '{"code":21211}'))).toBeNull();
    expect(twilioRejectionOf(new Error('{"code":21211}'))).toBeNull();
  });
});
