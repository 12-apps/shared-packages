import type { NotificationLogger } from '../types';

import type { PaidChannel } from './consent-text';
import type { NotificationsDb, NotificationsDbProvider } from './db';

/**
 * Delivery receipts: the provider's later answer about a message the
 * dispatcher already handed it, applied to the delivery row by the provider's
 * own id (kept on the row with SENT).
 *
 * FORWARD ONLY, in one guarded statement: `SENT → DELIVERED | UNDELIVERED`
 * (`READ` is folded into DELIVERED). The `where` pins `status = 'SENT'`, so the
 * first terminal answer wins, a duplicate changes nothing, a late or
 * out-of-order receipt never moves a row backwards, and of two conflicting
 * receipts racing each other exactly one applies.
 *
 * `{ applied: false }` is information, not an error: an unknown id, an id on
 * the other channel, or a receipt that RACED its own SENT write (the row has no
 * id yet). The host's receipt job retries the last kind, as `@12-apps/messaging`
 * does with its own.
 *
 * A PERMANENT failure (the provider says the number itself is bad) on a
 * grandfathered number drops the grandfathering, so the number stops receiving
 * (owner, 2026-11-16). A confirmed number is not touched: its owner proved it.
 *
 * A CONFIRMATION message (the ask, the code) has no delivery row: it is not a
 * notification. Its callback carries a tag naming the consent row it was sent
 * for (`confirmation`: Twilio's `parseTwilioCallback(params, { url })`, Meta's
 * `biz_opaque_callback_data` read with `confirmationOfWhatsAppStatus`), and its
 * receipt answers `{ applied: false, reason: 'not-tracked' }` — final, never
 * to be retried. A permanent failure on it still drops a grandfathering.
 */

/** The `biz_opaque_callback_data` prefix a WhatsApp confirmation is sent with. */
export const WHATSAPP_CONFIRMATION_CALLBACK_PREFIX = 'notifications-confirmation:';

/** The consent row a WhatsApp status's `biz_opaque_callback_data` names, or null. */
export function confirmationOfWhatsAppStatus(callbackData: string | null | undefined): string | null {
  if (!callbackData?.startsWith(WHATSAPP_CONFIRMATION_CALLBACK_PREFIX)) return null;
  const id = callbackData.slice(WHATSAPP_CONFIRMATION_CALLBACK_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * What a receipt did. `applied: false` alone may be retried (it may have raced
 * its own SENT write); with `reason: 'not-tracked'` it is final.
 */
export interface DeliveryReceiptOutcome {
  applied: boolean;
  reason?: 'not-tracked';
}

export type DeliveryReceiptStatus = 'SENT' | 'DELIVERED' | 'READ' | 'UNDELIVERED';

export interface DeliveryReceiptInput {
  channel: PaidChannel;
  providerMessageId: string;
  status: DeliveryReceiptStatus;
  at: Date;
  error?: string | null;
  /** The provider said the number itself is bad (invalid, landline, unknown). */
  permanent?: boolean;
  /**
   * The consent row a CONFIRMATION message was sent for, from its callback's
   * tag. Present, the receipt is not a delivery row's: see above.
   */
  confirmation?: string | null;
}

/** What `onDeliveryReceipt` is told, once per receipt that moved a row. */
export interface AppliedDeliveryReceipt {
  deliveryId: string;
  notificationId: string;
  /** The account, or `null` for a GUEST send (`notifyGuest`). */
  userId: string | null;
  channel: PaidChannel;
  status: 'DELIVERED' | 'UNDELIVERED';
  at: Date;
  error: string | null;
  permanent: boolean;
}

interface ReceiptDeps {
  db: NotificationsDbProvider;
  logger: NotificationLogger;
  onDeliveryReceipt?: (receipt: AppliedDeliveryReceipt) => void;
}

/** The number itself is bad: a grandfathered consent to it stops sends. */
async function dropGrandfathered(client: NotificationsDb, userId: string, channel: PaidChannel): Promise<void> {
  await client.notificationChannelConsent?.deleteMany({
    where: { userId, channel, status: 'GRANDFATHERED' },
  });
}

/** After the row moved: who it was for, the observer, and the grandfather drop. */
async function afterApplied(
  deps: ReceiptDeps,
  client: NotificationsDb,
  input: DeliveryReceiptInput,
  status: 'DELIVERED' | 'UNDELIVERED',
): Promise<void> {
  const [row] = await client.notificationDelivery.findMany({
    where: { channel: input.channel, providerMessageId: input.providerMessageId },
  });
  if (!row) return;
  const notification = await client.notification.findUnique({ where: { id: row.notificationId } });
  if (!notification) return;
  const permanent = status === 'UNDELIVERED' && input.permanent === true;
  // A guest has nothing grandfathered: a bad number simply stays DEAD.
  if (permanent && notification.userId !== null) await dropGrandfathered(client, notification.userId, input.channel);
  try {
    deps.onDeliveryReceipt?.({
      deliveryId: row.id,
      notificationId: row.notificationId,
      userId: notification.userId,
      channel: input.channel,
      status,
      at: input.at,
      error: status === 'UNDELIVERED' ? (input.error ?? null) : null,
      permanent,
    });
  } catch (error) {
    deps.logger.error(`[notifications] onDeliveryReceipt failed for ${row.id}:`, error);
  }
}

/** A confirmation's receipt: only a permanent failure on a grandfathered ask means anything. */
async function confirmationReceipt(deps: ReceiptDeps, input: DeliveryReceiptInput, rowId: string): Promise<DeliveryReceiptOutcome> {
  if (input.status === 'UNDELIVERED' && input.permanent === true) {
    const client = await deps.db();
    await client.notificationChannelConsent?.deleteMany({
      where: { id: rowId, channel: input.channel, status: 'GRANDFATHERED' },
    });
  }
  return { applied: false, reason: 'not-tracked' };
}

export async function applyDeliveryReceipt(
  deps: ReceiptDeps,
  input: DeliveryReceiptInput,
): Promise<DeliveryReceiptOutcome> {
  if (input.confirmation) return confirmationReceipt(deps, input, input.confirmation);
  const status = input.status === 'READ' ? 'DELIVERED' : input.status;
  // SENT (or anything in flight) moves nothing: the row is already SENT.
  if (status !== 'DELIVERED' && status !== 'UNDELIVERED') return { applied: false };
  const client = await deps.db();
  const { count } = await client.notificationDelivery.updateMany({
    where: { channel: input.channel, providerMessageId: input.providerMessageId, status: 'SENT' },
    data:
      status === 'DELIVERED'
        ? { status, deliveredAt: input.at }
        : { status, error: input.error ?? null },
  });
  if (count === 0) return { applied: false };
  try {
    await afterApplied(deps, client, input, status);
  } catch (error) {
    // The receipt IS applied; a failure telling others must not invite a retry.
    deps.logger.error('[notifications] a receipt applied, but its follow-up failed:', error);
  }
  return { applied: true };
}
