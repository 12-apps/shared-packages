import type { NormalizedWebhookEvent, ResolvedCredentials, WebhookDelivery } from '../core/types';
import { legacyNotificationKnown } from './pagbank-legacy-notifications';
import { postTransactionEvents, unsignedLegacyNotification } from './pagbank-webhook';
import { isConnectConnection, legacyUnresolvable, signerOf } from './pagbank-webhook-auth';

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
 *   it into NO event, reported once per delivery, so a forged one stores
 *   nothing. A SIGNED legacy delivery is never dropped: it parks as before.
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

/** Hears of each unsigned legacy notification acknowledged and dropped (`PagbankOptions.onUnresolvableLegacy`). */
type OnDropped = (notice: { notificationCode: string; reason: string }) => void;

/**
 * The events of a legacy delivery, or null when the body is the order JSON.
 *
 * Only an UNSIGNED one for a seller that can never resolve its code yields
 * none (acknowledged, never stored), and each such drop is reported, with its
 * code. A SIGNED one is stored as the parked UNKNOWN event whatever the seller
 * (`pagbank-webhook.ts`), so the host's resolver runs and fails or reports it
 * as it always did.
 */
export function legacyEvents(
  delivery: WebhookDelivery,
  credentials: ResolvedCredentials,
  eventId: string,
  onDropped?: OnDropped,
): NormalizedWebhookEvent[] | null {
  const unsigned = unsignedLegacyNotification(delivery.rawBody);
  if (unsigned && legacyUnresolvable(credentials) && signerOf(delivery, credentials) === null) {
    onDropped?.({ notificationCode: unsigned.notificationCode, reason: 'unsigned, and a Connect seller with no legacyToken cannot resolve it' });
    return [];
  }
  return postTransactionEvents(delivery.rawBody, eventId);
}
