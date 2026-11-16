import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import * as server from '../index';
import type { TransportRecipient } from '../../types';
import type { FetchImpl } from '../transports/drivers';
import { smsTransport, type SmsDriverDeclaration } from '../transports/sms';

/**
 * FUT-285 contract — the Twilio helpers, the twin of `@12-apps/messaging`'s
 * Meta ones (`verifyMetaSignature`, `parseWhatsAppStatuses`).
 *
 * On `main` there is none: no status callback is requested
 * (`transports/sms.ts:56-80` posts To/From/Body only), and a host has nothing
 * to verify or parse a Twilio callback with.
 *
 * The signature rule is Twilio's own: base64(HMAC-SHA1(authToken, url +
 * every POST param, sorted by name, as name+value)), sent in
 * `X-Twilio-Signature`.
 */

type Verify = (url: string, params: Record<string, string>, header: string | null | undefined, authToken: string) => boolean;

type TwilioCallback =
  | {
      kind: 'status';
      providerMessageId: string;
      status: 'SENT' | 'DELIVERED' | 'UNDELIVERED';
      errorCode: string | null;
      permanent: boolean;
    }
  | { kind: 'inbound'; externalId: string; from: string; to: string; text: string }
  | { kind: 'ignored'; reason: string };

type Parse = (params: Record<string, string>) => TwilioCallback;

const verify = (): Verify => server.verifyTwilioSignature;
const parse = (): Parse => server.parseTwilioCallback;

const AUTH_TOKEN = 'twilio-auth-token';
const URL_ = 'https://api.example.test/api/webhooks/platform-notifications/twilio';

/** Twilio's algorithm, written out here independently of the implementation. */
function sign(url: string, params: Record<string, string>, token = AUTH_TOKEN): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ''), url);
  return createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
}

const STATUS = {
  AccountSid: 'AC00000000000000000000000000000000',
  MessageSid: 'SM0123456789abcdef0123456789abcdef',
  MessageStatus: 'delivered',
  To: '+5511987654321',
  From: '+15550001111',
  ApiVersion: '2010-04-01',
};

describe('verifyTwilioSignature', () => {
  it('accepts the signature Twilio computes', () => {
    expect(verify()(URL_, STATUS, sign(URL_, STATUS), AUTH_TOKEN)).toBe(true);
  });

  it('refuses a tampered parameter, another URL, another token, or no header', () => {
    const header = sign(URL_, STATUS);
    expect(verify()(URL_, { ...STATUS, MessageStatus: 'undelivered' }, header, AUTH_TOKEN)).toBe(false);
    expect(verify()(`${URL_}?x=1`, STATUS, header, AUTH_TOKEN)).toBe(false);
    expect(verify()(URL_, STATUS, header, 'another-token')).toBe(false);
    expect(verify()(URL_, STATUS, null, AUTH_TOKEN)).toBe(false);
    expect(verify()(URL_, STATUS, undefined, AUTH_TOKEN)).toBe(false);
    expect(verify()(URL_, STATUS, '', AUTH_TOKEN)).toBe(false);
  });

  it('sorts by parameter name: the order the form arrived in does not matter', () => {
    const reversed = Object.fromEntries(Object.entries(STATUS).reverse());
    expect(verify()(URL_, reversed, sign(URL_, STATUS), AUTH_TOKEN)).toBe(true);
  });

  it('refuses an empty auth token rather than signing with it', () => {
    expect(verify()(URL_, STATUS, sign(URL_, STATUS, ''), '')).toBe(false);
  });
});

describe('parseTwilioCallback', () => {
  it('delivered → DELIVERED for that sid', () => {
    expect(parse()(STATUS)).toEqual({
      kind: 'status',
      providerMessageId: STATUS.MessageSid,
      status: 'DELIVERED',
      errorCode: null,
      permanent: false,
    });
  });

  it('sent → SENT (applied as a no-op by the receipt)', () => {
    expect(parse()({ ...STATUS, MessageStatus: 'sent' })).toMatchObject({ kind: 'status', status: 'SENT' });
  });

  it.each(['undelivered', 'failed'])('%s → UNDELIVERED with the error code', (status) => {
    expect(parse()({ ...STATUS, MessageStatus: status, ErrorCode: '30008' })).toEqual({
      kind: 'status',
      providerMessageId: STATUS.MessageSid,
      status: 'UNDELIVERED',
      errorCode: '30008',
      permanent: false,
    });
  });

  it.each(['30005', '30006', '21211', '21614'])('error %s is PERMANENT (the number itself is bad)', (code) => {
    expect(parse()({ ...STATUS, MessageStatus: 'undelivered', ErrorCode: code })).toMatchObject({
      status: 'UNDELIVERED',
      permanent: true,
    });
  });

  it.each(['30003', '30008', '30001'])('error %s is transient', (code) => {
    expect(parse()({ ...STATUS, MessageStatus: 'undelivered', ErrorCode: code })).toMatchObject({
      permanent: false,
    });
  });

  it.each(['queued', 'accepted', 'sending', 'scheduled'])('in-flight %s is ignored', (status) => {
    expect(parse()({ ...STATUS, MessageStatus: status })).toMatchObject({ kind: 'ignored' });
  });

  it('an inbound SMS (no MessageStatus, a Body) → inbound', () => {
    expect(
      parse()({
        AccountSid: STATUS.AccountSid,
        MessageSid: 'SMinbound0000000000000000000000000',
        SmsStatus: 'received',
        From: '+5511987654321',
        To: '+15550001111',
        Body: 'SAIR',
        NumMedia: '0',
      }),
    ).toEqual({
      kind: 'inbound',
      externalId: 'SMinbound0000000000000000000000000',
      from: '+5511987654321',
      to: '+15550001111',
      text: 'SAIR',
    });
  });

  it('a form with no MessageSid is ignored, never thrown on', () => {
    expect(parse()({ Foo: 'bar' })).toMatchObject({ kind: 'ignored' });
  });
});

describe('the twilio driver asks for a status callback', () => {
  const recipient: TransportRecipient = {
    userId: 'u1',
    email: null,
    phone: '+5511987654321',
    clientId: null,
    side: null,
    pushSubscriptionCount: 0,
  };

  function recording(): { fetchImpl: FetchImpl; bodies: string[] } {
    const bodies: string[] = [];
    return {
      bodies,
      fetchImpl: (_url, init) => {
        bodies.push(init?.body ?? '');
        return Promise.resolve({ ok: true, status: 201, text: () => Promise.resolve('{"sid":"SM1"}') });
      },
    };
  }

  const base = {
    channel: 'SMS' as const,
    driver: 'twilio',
    accountSid: 'AC1',
    authToken: AUTH_TOKEN,
    from: '+15550001111',
    defaultCountryCode: '55',
  };

  it('with `statusCallbackUrl` declared, every send carries StatusCallback', async () => {
    const { fetchImpl, bodies } = recording();
    const declaration = { ...base, fetchImpl, statusCallbackUrl: URL_ } as SmsDriverDeclaration;
    await smsTransport(declaration).send({ body: 'Oi' }, recipient);
    expect(new URLSearchParams(bodies[0]).get('StatusCallback')).toBe(URL_);
  });

  it('without it, no StatusCallback is sent (today\'s request, unchanged)', async () => {
    const { fetchImpl, bodies } = recording();
    await smsTransport({ ...base, fetchImpl }).send({ body: 'Oi' }, recipient);
    expect(new URLSearchParams(bodies[0]).has('StatusCallback')).toBe(false);
  });
});
