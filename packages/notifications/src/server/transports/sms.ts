import type {
  NotificationContent,
  NotificationLogger,
  NotificationTransport,
  TransportSendResult,
} from '../../types';

import {
  absoluteLink,
  fakeProviderId,
  phoneChannel,
  postOrThrow,
  resolveDriver,
  sentAs,
  type DriverDeclarationBase,
} from './drivers';
import { TWILIO_CONFIRMATION_PARAM } from '../twilio';

/**
 * SMS transport — Twilio behind the same driver port as email.
 *
 *   - `driver: 'twilio'` — the Messages API (form-encoded POST with basic
 *     auth, no SDK): `accountSid`, `authToken`, `from` (an E.164 sender or a
 *     Messaging Service SID).
 *   - `driver: 'log'` — dev driver: logs instead of sending.
 *   - no SMS declaration — channel unavailable, router skips it.
 *
 * A recipient without a normalizable phone is unavailable on this channel
 * regardless of the driver (see `../../phone.ts` for the verification caveat).
 */

/** The channel message the SMS formatter produces: one plain text body. */
export interface SmsMessage {
  body: string;
  /**
   * Set by the consent engine on a confirmation message (the consent row's
   * id): its `StatusCallback` names it, so its receipt is told apart from a
   * notification's (see `../twilio.ts`).
   */
  confirmation?: string;
}

export interface SmsDriver {
  /** May answer the provider's id for the message (see `TransportSendResult`). */
  send(toE164: string, message: SmsMessage): Promise<TransportSendResult | void>;
}

export interface SmsDriverDeclaration extends DriverDeclarationBase {
  channel: 'SMS';
  accountSid?: string;
  authToken?: string;
  from?: string;
  /**
   * Where Twilio posts this message's status callbacks (`StatusCallback`), so a
   * host can apply delivery receipts (`parseTwilioCallback` +
   * `applyDeliveryReceipt`). Absent = no callback is asked for, as before.
   */
  statusCallbackUrl?: string;
  appUrl?: string;
  /**
   * Country calling code for a bare local number, digits only (`'55'`, `'1'`).
   * REQUIRED: this package assumes no country, because the one it used to
   * assume turned a US number into a plausible Brazilian mobile and texted a
   * stranger the customer's order (see `../../phone.ts`).
   */
  defaultCountryCode: string;
  logger?: NotificationLogger;
}

/** SMS bodies are billed per 160-char segment — keep one message ≤ 3 segments. */
const MAX_SMS_CHARS = 480;

/** The callback URL, tagged with the consent row on a confirmation message. */
function statusCallbackOf(url: string, confirmation: string | undefined): string {
  if (!confirmation) return url;
  const tagged = new URL(url);
  tagged.searchParams.set(TWILIO_CONFIRMATION_PARAM, confirmation);
  return tagged.toString();
}

const twilioDriver = (declaration: SmsDriverDeclaration): SmsDriver => ({
  async send(toE164, message) {
    const sid = declaration.accountSid;
    if (!sid || !declaration.authToken || !declaration.from) {
      throw new Error('The twilio sms driver needs `accountSid`, `authToken` and `from`.');
    }
    const auth = Buffer.from(`${sid}:${declaration.authToken}`).toString('base64');
    const form = new URLSearchParams({ To: toE164, From: declaration.from, Body: message.body });
    if (declaration.statusCallbackUrl) {
      form.set('StatusCallback', statusCallbackOf(declaration.statusCallbackUrl, message.confirmation));
    }
    const answer = await postOrThrow(
      'Twilio',
      declaration.fetchImpl,
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${auth}`,
        },
        body: form.toString(),
      },
    );
    // Twilio answers the Message resource; its `sid` is what callbacks carry.
    return sentAs((answer as { sid?: unknown } | null)?.sid);
  },
});

const logSmsDriver = (declaration: SmsDriverDeclaration): SmsDriver => ({
  // Deliberately logs NO destination — a phone number is PII and must never
  // reach logs; the message body alone is enough for local debugging.
  send(_toE164, message) {
    declaration.logger?.info(
      `[notifications:sms] log driver suppressed a real send (body="${message.body}")`,
    );
    return Promise.resolve(fakeProviderId('sms'));
  },
});

export const SMS_DRIVERS: Record<string, (declaration: SmsDriverDeclaration) => SmsDriver> = {
  twilio: twilioDriver,
  log: logSmsDriver,
};

/** Agnostic content → one plain SMS: "title: body (link)", length-capped. */
export function formatSms(
  content: NotificationContent,
  declaration: SmsDriverDeclaration,
): SmsMessage {
  const parts = [`${content.title}: ${content.body}`];
  const href = absoluteLink(content.link, declaration.appUrl);
  if (href) parts.push(href);
  const body = parts.join(' ');
  return { body: body.length > MAX_SMS_CHARS ? `${body.slice(0, MAX_SMS_CHARS - 1)}…` : body };
}

export function smsTransport(
  declaration: SmsDriverDeclaration,
  extraDrivers: Record<string, (d: SmsDriverDeclaration) => SmsDriver> = {},
): NotificationTransport<SmsMessage> {
  const driver = resolveDriver('SMS', declaration, { ...SMS_DRIVERS, ...extraDrivers });
  return phoneChannel<SmsMessage>('SMS', {
    defaultCountryCode: declaration.defaultCountryCode,
    format: (content) => formatSms(content, declaration),
    send: (toE164, message) => driver.send(toE164, message),
  });
}
