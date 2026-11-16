import { createHmac, timingSafeEqual } from 'node:crypto';

import { NotificationProviderError } from './transports/drivers';

/**
 * Twilio's webhook helpers — the twin of `@12-apps/messaging`'s Meta
 * ones. The ROUTE is the host's (its path, its body parser, its auth token);
 * the package owns the two rules a host would otherwise copy and get subtly
 * wrong: how Twilio signs a callback, and what a callback means.
 */

/**
 * Twilio's signature rule: base64(HMAC-SHA1(authToken, url + every POST
 * parameter, sorted by name, as name + value)), sent in `X-Twilio-Signature`.
 *
 * `url` is the FULL URL Twilio called, query string included, exactly as
 * configured — behind a proxy, the public one. An empty token is refused rather
 * than signed with: a missing secret must fail closed.
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  header: string | null | undefined,
  authToken: string,
): boolean {
  if (!authToken || !header) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + (params[key] ?? ''), url);
  const expected = Buffer.from(createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64'));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** What one Twilio callback means. */
export type TwilioCallback =
  | {
      kind: 'status';
      providerMessageId: string;
      status: 'SENT' | 'DELIVERED' | 'UNDELIVERED';
      errorCode: string | null;
      /** The number itself is bad: a receipt that should stop sends to it. */
      permanent: boolean;
      /**
       * Only on a CONFIRMATION message's callback (read off `options.url`):
       * the consent row it was sent for. Pass it on as the receipt's
       * `confirmation`.
       */
      confirmation?: string;
    }
  | { kind: 'inbound'; externalId: string; from: string; to: string; text: string }
  | { kind: 'ignored'; reason: string };

/**
 * The status-callback `ErrorCode`s that say the NUMBER is bad rather than the
 * moment: unknown handset (30005) and landline or unreachable carrier (30006).
 * The rest (30003 unreachable, 30008 unknown, 30001 queue overflow, …) are
 * transient.
 *
 * 21211 (invalid 'To') and 21614 (not a mobile number) are REST API errors:
 * Twilio answers them with HTTP 400 when the message is CREATED, so they reach
 * the dispatcher synchronously and are classified there
 * ({@link twilioRejectionOf}). They stay in this set only because a message
 * queued through a Messaging Service can report them later, on its callback.
 */
const PERMANENT_ERROR_CODES = new Set(['30005', '30006', '21211', '21614']);

/** What a synchronous provider rejection says about the NUMBER. */
export type ProviderRejection = 'BAD_NUMBER' | 'OPTED_OUT';

/**
 * Twilio's REST error codes that are about the number, never the moment:
 * invalid 'To' (21211), not a mobile number (21614), and 21610 — the recipient
 * replied STOP to the sender, so Twilio refuses every message to it until they
 * reply START.
 */
const REST_REJECTIONS: Record<string, ProviderRejection> = {
  '21211': 'BAD_NUMBER',
  '21614': 'BAD_NUMBER',
  '21610': 'OPTED_OUT',
};

/** The `code` of a Twilio REST error body, or null when it carries none. */
function restCodeOf(detail: string): string | null {
  try {
    const code = (JSON.parse(detail) as { code?: unknown } | null)?.code;
    return typeof code === 'number' || typeof code === 'string' ? String(code) : null;
  } catch {
    return null;
  }
}

/**
 * A send that Twilio refused SYNCHRONOUSLY, classified: `BAD_NUMBER` and
 * `OPTED_OUT` are permanent (retrying spends a claim, a cap and a provider
 * call on an answer that will not change), anything else is `null` and keeps
 * the ordinary retry. Only the built-in twilio driver's errors are read.
 */
export function twilioRejectionOf(error: unknown): ProviderRejection | null {
  if (!(error instanceof NotificationProviderError) || error.vendor !== 'Twilio') return null;
  const code = restCodeOf(error.detail);
  return code === null ? null : (REST_REJECTIONS[code] ?? null);
}

const STATUS_OF: Record<string, 'SENT' | 'DELIVERED' | 'UNDELIVERED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'DELIVERED',
  undelivered: 'UNDELIVERED',
  failed: 'UNDELIVERED',
};

/** A message a person sent TO the host's number. */
function inboundOf(sid: string, params: Record<string, string>): TwilioCallback {
  if (params.Body === undefined || !params.From) return { kind: 'ignored', reason: 'no status and no body' };
  return { kind: 'inbound', externalId: sid, from: params.From, to: params.To ?? '', text: params.Body };
}

/**
 * A status callback (`MessageStatus`) or an inbound message (`Body`, no status
 * or `received`), already signature-checked by the caller. In-flight statuses
 * (queued, accepted, sending, scheduled) and anything unrecognised are
 * `ignored` — never thrown on, since Twilio retries a callback that errors.
 */
/** The query parameter a confirmation's `StatusCallback` carries its consent row in. */
export const TWILIO_CONFIRMATION_PARAM = 'notificationsConfirmation';

/** The consent row a callback URL names, or null (also for a URL that does not parse). */
function confirmationOfUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get(TWILIO_CONFIRMATION_PARAM) || null;
  } catch {
    return null;
  }
}

/**
 * `options.url` is the URL Twilio called (the one the signature is checked
 * against): a confirmation message's callback is told apart by it.
 */
export function parseTwilioCallback(
  params: Record<string, string>,
  options: { url?: string } = {},
): TwilioCallback {
  const sid = params.MessageSid ?? params.SmsSid;
  if (!sid) return { kind: 'ignored', reason: 'no MessageSid' };
  const raw = params.MessageStatus ?? params.SmsStatus;
  if (raw === undefined || raw === 'received') return inboundOf(sid, params);
  const status = STATUS_OF[raw];
  if (!status) return { kind: 'ignored', reason: `in-flight status ${raw}` };
  const errorCode = params.ErrorCode ? params.ErrorCode : null;
  const confirmation = confirmationOfUrl(options.url);
  return {
    kind: 'status',
    providerMessageId: sid,
    status,
    errorCode,
    permanent: status === 'UNDELIVERED' && errorCode !== null && PERMANENT_ERROR_CODES.has(errorCode),
    ...(confirmation ? { confirmation } : {}),
  };
}
