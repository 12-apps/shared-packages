import type { NotificationChannel, TransportRecipient } from '../types';

import type { NotificationDeliveryRow, NotificationsDb } from './db';
import type { NotificationDispatchDeps } from './dispatch';
import { twilioRejectionOf } from './twilio';

/**
 * What a claimed send left behind: SENT once the provider took it, or the
 * failure — retried, terminal at the ceiling, or DEAD at once when the
 * provider refused the number itself. Split from `./dispatch.ts`, which claims.
 */

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Record the outcome of a claimed send — terminal once the ceiling is hit. */
async function settle(
  deps: NotificationDispatchDeps,
  client: NotificationsDb,
  delivery: NotificationDeliveryRow,
  error: unknown,
): Promise<void> {
  // `attempts` was read BEFORE this claim incremented it, so `+ 1` is the
  // attempt that just failed.
  const spent = delivery.attempts + 1;
  const terminal = spent >= deps.maxAttempts;
  await client.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status: terminal ? 'DEAD' : 'FAILED',
      error: terminal ? `${messageOf(error)} (gave up after ${spent} attempts)` : messageOf(error),
    },
  });
}

/**
 * The provider took the message: write SENT. The provider's id (what a receipt
 * finds the row by) is written BEST-EFFORT, with SENT when it can be: a write
 * that fails over it — a unique clash, a host whose client predates the column
 * — is retried as a plain SENT, and a failure here never reaches `settle()`.
 * The message WENT; a FAILED row would be re-queued by the sweep and sent
 * twice, a second billed message to a real phone.
 */
export async function markSent(
  deps: NotificationDispatchDeps,
  client: NotificationsDb,
  deliveryId: string,
  providerMessageId: string | undefined,
): Promise<void> {
  const sent = { status: 'SENT' as const, sentAt: new Date(), error: null };
  try {
    await client.notificationDelivery.update({
      where: { id: deliveryId },
      // Absent, the id key is not written at all.
      data: { ...sent, ...(providerMessageId ? { providerMessageId } : {}) },
    });
    return;
  } catch (error) {
    if (!providerMessageId) {
      deps.logger.error(`[notifications] delivery ${deliveryId} was sent, but SENT could not be written:`, error);
      return;
    }
    deps.logger.error(`[notifications] delivery ${deliveryId} was sent; its provider id could not be kept:`, error);
  }
  try {
    await client.notificationDelivery.update({ where: { id: deliveryId }, data: sent });
  } catch (error) {
    deps.logger.error(`[notifications] delivery ${deliveryId} was sent, but SENT could not be written:`, error);
  }
}

/**
 * A send that threw. A provider refusal of the NUMBER (`./twilio.ts`) is DEAD at
 * once — no retry can change the answer, and each one would spend a claim, a
 * cap and a provider call — and the consent engine is told; anything else is
 * an ordinary failure, retried up to the ceiling.
 */
export async function failed(
  deps: NotificationDispatchDeps,
  client: NotificationsDb,
  delivery: NotificationDeliveryRow,
  recipient: TransportRecipient,
  error: unknown,
): Promise<void> {
  const kind = twilioRejectionOf(error);
  if (kind === null) {
    await settle(deps, client, delivery, error);
    return;
  }
  await client.notificationDelivery.update({
    where: { id: delivery.id },
    data: { status: 'DEAD', error: `${messageOf(error)} (permanent: ${kind})` },
  });
  try {
    await deps.onRejected?.({
      deliveryId: delivery.id,
      userId: recipient.guest ? null : recipient.userId,
      phone: recipient.phone,
      channel: delivery.channel as NotificationChannel,
      kind,
    });
  } catch (hookError) {
    deps.logger.error(`[notifications] recording the refusal of ${delivery.id} failed:`, hookError);
  }
}
