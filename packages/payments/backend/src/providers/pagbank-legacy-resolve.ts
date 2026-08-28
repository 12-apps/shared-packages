import type { CredentialStore } from '../core/ports';
import type { MerchantRef, ResolvedCredentials } from '../core/types';
import type { NormalizedWebhookEvent } from '../core/webhook-event-types';

import { resolvePagbankNotification } from './pagbank-legacy-notifications';

/**
 * PagBank's LEGACY post-transaction notifications, resolved (FUT-477, FUT-764).
 *
 * This package already recognizes the second webhook shape — the form-encoded
 * `notificationCode` delivery carrying settlements, chargebacks and
 * cancellations — parks it as an `UNKNOWN` event with the code on `raw`, and
 * ships `resolvePagbankNotification` to turn that code into what it meant.
 * What it did NOT ship was the piece joining the two, so the first adopting
 * host wrote it: reading the code back off the parked event, looking the
 * merchant's LISTENING credentials up, and refusing loudly when there are none.
 *
 * Every fact in that piece is this package's. The event shape is
 * `pagbank-webhook.ts`'s, the credential lookup and its pre-`getConnectedCredentials`
 * fallback are `CredentialStore`'s, and the resolver is ours. A host had no way
 * to get any of it right except by reading our source.
 *
 * **Credentials come from the LISTENING lookup**, like every inbound-delivery
 * concern: a chargeback is about money that already moved, so whether the owner
 * currently routes NEW charges to PagBank is irrelevant.
 */

/**
 * The `notificationCode` of a parked legacy delivery, or `null` when the event
 * is not one — matching exactly what this package's own PagBank webhook emits.
 */
export function legacyNotificationCode(event: NormalizedWebhookEvent): string | null {
  if (event.provider !== 'pagbank' || event.type !== 'UNKNOWN') return null;
  const raw = event.raw;
  if (typeof raw !== 'object' || raw === null) return null;
  const code = (raw as Record<string, unknown>).notificationCode;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

/**
 * LISTENING credentials, with the same fallback the webhook pipeline uses:
 * a store predating `getConnectedCredentials` keeps the charging lookup.
 */
async function listeningCredentials(
  credentials: CredentialStore,
  merchant: MerchantRef,
): Promise<ResolvedCredentials | null> {
  const listen = credentials.getConnectedCredentials;
  if (listen) return listen.call(credentials, merchant, 'pagbank');
  return credentials.getCredentials(merchant, 'pagbank');
}

/**
 * A `resolveLegacyEvents` port for {@link createWebhookReactor}, bound to one
 * credential store.
 *
 * A resolvable delivery with no credentials behind it THROWS rather than
 * returning null: the inbox row goes FAILED with the reason on `lastError` and
 * the drain's bounded retries come back for it. Swallowing it would drop a
 * chargeback on the floor, which is the exact silence this resolution exists
 * to end.
 */
export function pagbankLegacyResolver(
  credentials: CredentialStore,
): (event: NormalizedWebhookEvent, merchant: MerchantRef) => Promise<NormalizedWebhookEvent[] | null> {
  return async (event, merchant) => {
    const code = legacyNotificationCode(event);
    if (!code) return null;
    const resolved = await listeningCredentials(credentials, merchant);
    if (!resolved) {
      throw new Error(
        `pagbank legacy notification ${code}: no pagbank credentials for ` +
          `${merchant.kind}:${merchant.id}; cannot resolve`,
      );
    }
    return resolvePagbankNotification(code, resolved);
  };
}
