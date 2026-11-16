import { createHmac, timingSafeEqual } from 'node:crypto';

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
    }
  | { kind: 'inbound'; externalId: string; from: string; to: string; text: string }
  | { kind: 'ignored'; reason: string };

/**
 * The error codes that say the NUMBER is bad rather than the moment:
 * unknown/unreachable handset (30005), landline (30006), invalid 'To' (21211),
 * not a mobile number (21614). The rest (30003 unreachable, 30008 unknown,
 * 30001 queue overflow, …) are transient.
 */
const PERMANENT_ERROR_CODES = new Set(['30005', '30006', '21211', '21614']);

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
export function parseTwilioCallback(params: Record<string, string>): TwilioCallback {
  const sid = params.MessageSid ?? params.SmsSid;
  if (!sid) return { kind: 'ignored', reason: 'no MessageSid' };
  const raw = params.MessageStatus ?? params.SmsStatus;
  if (raw === undefined || raw === 'received') return inboundOf(sid, params);
  const status = STATUS_OF[raw];
  if (!status) return { kind: 'ignored', reason: `in-flight status ${raw}` };
  const errorCode = params.ErrorCode ? params.ErrorCode : null;
  return {
    kind: 'status',
    providerMessageId: sid,
    status,
    errorCode,
    permanent: status === 'UNDELIVERED' && errorCode !== null && PERMANENT_ERROR_CODES.has(errorCode),
  };
}
