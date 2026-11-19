import type { NormalizedWebhookEvent, ResolvedCredentials, WebhookDelivery } from '../core/types';
import { legacyNotificationKnown } from './pagbank-legacy-notifications';
import { postTransactionEvents, unsignedLegacyNotification } from './pagbank-webhook';
import { isConnectConnection, legacyUnresolvable } from './pagbank-webhook-auth';

/**
 * The PagBank adapter's webhook surface for legacy post-transaction
 * notifications (FUT-5371), kept apart from `pagbank.ts`.
 *
 * An unsigned one in its documented shape (`unsignedLegacyNotification`) is
 * verified before anything is stored:
 *
 * - credentials that can ask the legacy host must find the code there: the
 *   lookup is the authentication, as the order consult is for an unsigned
 *   Connect order (FUT-3722), and an unknown code is refused like a bad
 *   signature;
 * - a Connect seller with no account token apart cannot ask it, ever: the
 *   delivery is acknowledged so PagBank stops redelivering, and `parse` turns
 *   it into NO event, so a forged one costs nothing and stores nothing.
 *
 * Any other unsigned body falls through to the order path, unchanged.
 */

/** The verdict on an unsigned legacy notification, or null when the delivery is not one. */
export function verifyUnsignedLegacy(delivery: WebhookDelivery, credentials: ResolvedCredentials): Promise<boolean> | null {
  const legacy = unsignedLegacyNotification(delivery.rawBody);
  if (!legacy) return null;
  return legacyUnresolvable(credentials) ? Promise.resolve(true) : legacyNotificationKnown(legacy.notificationCode, credentials);
}

/** How an unsigned delivery was let in, for the once-per-process signer line. */
export function unsignedSigner(delivery: WebhookDelivery, credentials: ResolvedCredentials): string | null {
  if (unsignedLegacyNotification(delivery.rawBody)) return legacyUnresolvable(credentials) ? 'legacyAcknowledged' : 'legacyLookup';
  return isConnectConnection(credentials) ? 'orderConsult' : null;
}

/**
 * The events of a legacy delivery, or null when the body is the order JSON:
 * none for one nothing could ever resolve for this seller (acknowledged, never
 * stored); otherwise the parked UNKNOWN event (`pagbank-webhook.ts`).
 */
export function legacyEvents(delivery: WebhookDelivery, credentials: ResolvedCredentials, eventId: string): NormalizedWebhookEvent[] | null {
  if (unsignedLegacyNotification(delivery.rawBody) && legacyUnresolvable(credentials)) return [];
  return postTransactionEvents(delivery.rawBody, eventId);
}
