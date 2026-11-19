import type { NormalizedWebhookEvent } from '../core/types';
import { NAME } from './pagbank-http';
import { sha256Hex } from './shared';

/**
 * PagBank's SECOND webhook format — post-transaction events (FUT-477).
 *
 * `reference/webhooks` is explicit, and it is easy to miss because it sits
 * under an "ATENÇÃO" callout rather than in the schema:
 *
 *   > No momento, eventos de pós-transação (disponibilização de saldo,
 *   > chargebacks e cancelamentos) serão enviados para a mesma URL, mas em
 *   > outro formato
 *
 *   notificationCode=093C100E7FA87FA8C0B664B79F8359773B96
 *   notificationType=transaction
 *
 * So the SAME endpoint receives two unrelated shapes: the Orders API's JSON
 * order object, and this — form-encoded, from the legacy PagSeguro
 * notification system. `webhook.parse` fed every delivery to `JSON.parse`,
 * which throws on this one; the pipeline then marks the row FAILED and the
 * provider redelivers, forever, because a retry cannot fix a body we do not
 * understand.
 *
 * WHAT IT DOES NOT CARRY IS THE POINT. There is no status, no charge, no
 * amount — only an opaque code. Learning what happened means a GET against the
 * LEGACY host with account credentials this integration does not hold:
 *
 *   https://ws.pagseguro.uol.com.br/v3/transactions/notifications/{code}
 *     ?email={email_conta}&token={token_api}
 *
 * ...which answers in XML. That resolution is deliberately NOT done here: it
 * needs a different host, a different credential pair (`email` + `token_api`,
 * not the Connect access token) and an XML parser. Recognizing the delivery is
 * what stops the redelivery loop; resolving it is
 * `pagbank-legacy-notifications.ts` (`resolvePagbankNotification`), which a
 * host runs over these UNKNOWN rows' stored codes.
 */

/** The two fields a post-transaction delivery carries. */
interface PagBankNotification {
  notificationCode: string;
  /** e.g. `transaction`. Documented as up to 41 chars, values unpublished. */
  notificationType: string | null;
}

/**
 * Read a post-transaction notification, or `null` when this is not one.
 *
 * Deliberately narrow: it matches only on a present, non-empty
 * `notificationCode`, so an ordinary JSON order body always falls through to
 * the JSON path. `notificationType` is reported as `null` rather than
 * defaulted, because a delivery missing it is something to see, not guess at.
 */
function postTransactionNotification(rawBody: string): PagBankNotification | null {
  // A JSON body parses as a query string without complaint, so rule out the
  // shape that unambiguously is not one before looking at keys at all.
  if (rawBody.trimStart().startsWith('{')) return null;
  const params = new URLSearchParams(rawBody);
  const notificationCode = params.get('notificationCode');
  if (!notificationCode) return null;
  return { notificationCode, notificationType: params.get('notificationType') };
}

/**
 * A legacy notification code as PagBank writes it: 36 hex digits, bare (its
 * documentation's example) or in groups of 6-12-12-6 (every delivery production
 * received on 2026-11-19, e.g. `3F6E06-E39BE59BE515-000471CF9624-390FE5`).
 */
const LEGACY_CODE = /^(?:[0-9A-F]{36}|[0-9A-F]{6}-[0-9A-F]{12}-[0-9A-F]{12}-[0-9A-F]{6})$/iu;
/** `notificationType`: documented as up to 41 characters, values unpublished (`transaction` seen). */
const LEGACY_TYPE = /^[A-Za-z_]{1,41}$/u;
const LEGACY_KEYS = new Set(['notificationCode', 'notificationType']);

/**
 * The legacy notification an UNSIGNED delivery may be taken as (FUT-5371), or
 * null when it is anything else.
 *
 * PagBank posts these without `x-authenticity-token`: production showed it on
 * 2026-11-19, every one of them, on the homologação seller's route and on a
 * store's. Refused at verification, they never reached `parse`, and PagBank
 * redelivered each one. So an unsigned delivery is let past verification only
 * in exactly the documented shape: the two documented keys, each once, a code
 * in PagBank's format and a plain type. Anything else (an extra key, a code of
 * another shape) is refused as before. Its event id is derived from the code
 * alone (`legacyEventId`), so a redelivery, or the same code re-posted with
 * its keys in another order, is one inbox row. What the code MEANS is still
 * only what the legacy lookup with the merchant's credentials answers; the
 * adapter's `verify` asks it before anything is stored when it can.
 */
export function unsignedLegacyNotification(rawBody: string): PagBankNotification | null {
  const notification = postTransactionNotification(rawBody);
  if (!notification || !LEGACY_CODE.test(notification.notificationCode)) return null;
  const keys = [...new URLSearchParams(rawBody).keys()];
  if (keys.some((key) => !LEGACY_KEYS.has(key)) || new Set(keys).size !== keys.length) return null;
  const type = notification.notificationType;
  return type === null || LEGACY_TYPE.test(type) ? notification : null;
}

/** One event id per legacy code, whatever the body around it: dashes and case do not make a new one. */
function legacyEventId(notificationCode: string): string {
  return sha256Hex(`pagbank-legacy-delivery:${notificationCode.replace(/-/gu, '').toUpperCase()}`);
}

/**
 * The normalized events for a post-transaction delivery, or `null` when the
 * body is not one and the caller should fall through to the order JSON.
 *
 * UNKNOWN is the honest type and the reason is in the header above: the body
 * says only that SOMETHING happened to a transaction, never what. Emitting
 * CHARGE_UPDATED here would assert a state nothing in the delivery supports —
 * and on this provider that state settles money.
 *
 * The parsed pair rides on `raw` so the inbox row carries the one thing that
 * makes the event resolvable later: the code to look it up with.
 */
export function postTransactionEvents(
  rawBody: string,
  eventId: string,
): NormalizedWebhookEvent[] | null {
  const notification = postTransactionNotification(rawBody);
  if (!notification) return null;
  // A code in PagBank's format is keyed by the code itself (FUT-5371): redeliveries and variants dedupe.
  const id = LEGACY_CODE.test(notification.notificationCode) ? legacyEventId(notification.notificationCode) : eventId;
  return [{ provider: NAME, eventId: id, type: 'UNKNOWN', raw: notification }];
}
