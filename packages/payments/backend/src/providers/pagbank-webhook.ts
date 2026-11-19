import type { NormalizedWebhookEvent } from '../core/types';
import { NAME } from './pagbank-http';

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
 * Whether a delivery is a legacy post-transaction notification (FUT-5371).
 *
 * PagBank posts these UNSIGNED: production showed it on 2026-11-19, every one
 * of them without `x-authenticity-token`, on the homologação seller's route and
 * on a store's (Sentry PALADIRA-BACKEND-46, -5F, -7C). They used to be refused
 * at verification, before `parse` could park them, so PagBank redelivered each
 * one and every refusal reached the error tracker — and the resolution FUT-477
 * built for them was never reached in production.
 *
 * Accepting one unsigned is safe because nothing in it is believed. `parse`
 * turns it into an UNKNOWN event that carries only the code; what the code
 * MEANS is learned by the legacy lookup with the merchant's own credentials,
 * which answers only for a transaction of that account. A forged code can at
 * most make us ask PagBank about a transaction that does not exist — the same
 * bound the order consult of an unsigned Connect delivery has (FUT-3722).
 */
export function isLegacyNotification(rawBody: string): boolean {
  return postTransactionNotification(rawBody) !== null;
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
  return [{ provider: NAME, eventId, type: 'UNKNOWN', raw: notification }];
}
