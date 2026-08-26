import type {
  DeliveryStatus,
  NotificationChannel,
  NotificationContent,
  NotificationLogger,
  TransportRecipient,
} from '../types';

import type {
  NotificationContactDirectory,
  NotificationDeliveryRow,
  NotificationsDb,
  NotificationsDbProvider,
} from './db';
import type { PushSubscriptionStore } from './push-subscriptions';
import type { TransportRegistry } from './transports/registry';

/**
 * Handing a delivery to its transport, and the retry sweep that re-hands the
 * ones that did not make it (12-15).
 *
 * ## Every send is CLAIMED first
 *
 * A dispatcher never sends a row it merely READ. It moves the row `QUEUED →
 * SENDING` with one conditional `updateMany` whose `where` carries the
 * precondition, and sends only when that statement reports `count === 1`:
 *
 *     updateMany({ where: { id, status: 'QUEUED' }, data: { status: 'SENDING' } })
 *
 * The database decides the winner, in one statement, so two dispatchers racing
 * the same delivery produce exactly one provider call. The version this replaced
 * read the QUEUED rows, called `transport.send`, and only then wrote `SENT` —
 * with nothing marking the row taken in between, which is a read-validate-write
 * with a network round trip in the window. It needed no crash to double-send: a
 * sweep whose backlog outlived its own cron interval overlapped itself, and
 * every row the first run had not yet reached was sent twice. On SMS and
 * WhatsApp that is a second billed message to a real phone.
 *
 * A single-threaded fake cannot tell the two implementations apart, which is why
 * the concurrency contracts are pinned against real SQL in
 * `harness/backend/tests/notifications-pipeline.test.ts` as well as against the
 * in-memory seam.
 *
 * ## Nothing is retried forever
 *
 * Each claim increments `attempts` — at CLAIM time, so a dispatcher that dies
 * mid-send still spends one — and the `maxAttempts`-th failure writes `DEAD`
 * instead of `FAILED`. A `DEAD` row is terminal: no sweep selects it again.
 * Without a ceiling a permanently invalid destination is a billed provider call
 * on every sweep for the life of the row, and the sweep's working set only ever
 * grows.
 *
 * ## The sweep is bounded and cannot un-send
 *
 * It selects on `updatedAt` (never `createdAt`), takes at most `take` rows, and
 * re-queues each one with the same conditional-update shape — status pinned to
 * what was read, plus the staleness predicate. A row another dispatcher has
 * already moved fails that predicate, so a committed `SENT` can never be dragged
 * back to `QUEUED`.
 */

/** Claims a delivery gets before it is DEAD. Overridable per mount. */
export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 5;

/** Rows one sweep may take. Bounds a run to well inside a cron interval. */
export const DEFAULT_SWEEP_TAKE = 200;

/** Default staleness cutoff: a row that has not moved in five minutes. */
export const DEFAULT_SWEEP_CUTOFF_MS = 5 * 60_000;

/**
 * The statuses a sweep may return to QUEUED, once stale.
 *
 * `SENDING` is in the list because that is what a dispatcher that died mid-send
 * leaves behind, and it is safe precisely because of the cutoff: a SENDING row
 * younger than the cutoff belongs to a dispatcher that is still working.
 * `SENT` and `DEAD` are absent, and that is the whole point of them.
 */
const RETRYABLE: DeliveryStatus[] = ['FAILED', 'QUEUED', 'SENDING'];

/** What dispatch needs from the mount. */
export interface NotificationDispatchDeps {
  db: NotificationsDbProvider;
  transports: TransportRegistry;
  pushSubscriptions: PushSubscriptionStore;
  contacts: NotificationContactDirectory;
  logger: NotificationLogger;
  maxAttempts: number;
}

/** Load the recipient's destinations once, for every transport's gate. */
export async function loadRecipient(
  deps: NotificationDispatchDeps,
  userId: string,
): Promise<TransportRecipient | null> {
  const contact = await deps.contacts.getContact(userId);
  if (!contact) return null;
  return {
    userId,
    email: contact.email,
    phone: contact.phone,
    // Carried through UNRESOLVED and only where the host supplied one: the
    // absent case has to stay distinguishable from a stated language, because
    // that is what lets a generator apply its own default in one place.
    ...(contact.locale === undefined ? {} : { locale: contact.locale }),
    pushSubscriptionCount: await deps.pushSubscriptions.count(userId),
  };
}

/** The stored inbox row, back as the agnostic content a formatter takes. */
function contentOf(notification: {
  title: string;
  body: string;
  link: string | null;
  data: unknown;
}): NotificationContent {
  return {
    title: notification.title,
    body: notification.body,
    ...(notification.link !== null ? { link: notification.link } : {}),
    data: (notification.data ?? {}) as Record<string, unknown>,
  };
}

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
 * Claim one delivery and, if we won it, send it.
 *
 * Resolves whether a provider call was made, which is what the sweep counts —
 * "dispatched" must mean sends attempted, not rows looked at.
 */
async function sendClaimed(
  deps: NotificationDispatchDeps,
  client: NotificationsDb,
  delivery: NotificationDeliveryRow,
  content: NotificationContent,
  recipient: TransportRecipient,
): Promise<boolean> {
  const claimed = await client.notificationDelivery.updateMany({
    where: { id: delivery.id, status: 'QUEUED' },
    data: { status: 'SENDING', attempts: { increment: 1 } },
  });
  // Someone else moved it between our read and here. They own the send now.
  if (claimed.count !== 1) return false;

  const transport = deps.transports.get(delivery.channel as NotificationChannel);
  try {
    if (!transport) throw new Error(`No transport declared for ${delivery.channel}.`);
    await transport.send(transport.format(content) as never, recipient);
    await client.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'SENT', sentAt: new Date(), error: null },
    });
  } catch (error) {
    await settle(deps, client, delivery, error);
  }
  return true;
}

/**
 * The recipient no longer exists, so no channel will ever reach them.
 *
 * The rows are marked DEAD rather than left QUEUED: `getContact` returning null
 * is the host saying "no such person" (the same answer `notify` throws on), and
 * a QUEUED row for a deleted account is a row every sweep, forever, picks up and
 * cannot deliver.
 */
async function abandonUnreachable(
  deps: NotificationDispatchDeps,
  client: NotificationsDb,
  queued: readonly NotificationDeliveryRow[],
  userId: string,
): Promise<void> {
  deps.logger.error(
    `[notifications] no contact for user ${userId}: ${queued.length} delivery row(s) marked DEAD`,
  );
  for (const delivery of queued) {
    await client.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'DEAD', error: 'The contact directory no longer knows this recipient.' },
    });
  }
}

/**
 * Send every still-QUEUED delivery of one notification, claiming each one first.
 *
 * Safe to call repeatedly and safe to call concurrently: SENT, SENDING and DEAD
 * rows are not selected, and of two callers that both read the same QUEUED row
 * only one wins the claim.
 */
export async function dispatchOne(
  deps: NotificationDispatchDeps,
  notificationId: string,
): Promise<number> {
  const client = await deps.db();
  const notification = await client.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return 0;
  const queued = await client.notificationDelivery.findMany({
    where: { notificationId, status: 'QUEUED' },
  });
  if (queued.length === 0) return 0;

  const recipient = await loadRecipient(deps, notification.userId);
  if (!recipient) {
    await abandonUnreachable(deps, client, queued, notification.userId);
    return 0;
  }

  const content = contentOf(notification);
  // Sequential on purpose: one recipient's channels (2–4 sends) gain little
  // from parallelism, and providers rate-limit per sender anyway.
  let sent = 0;
  for (const delivery of queued) {
    if (await sendClaimed(deps, client, delivery, content, recipient)) sent += 1;
  }
  return sent;
}

/**
 * Return one stale row to QUEUED, or report that somebody else got there first.
 *
 * The `where` is the guard, and every clause of it is load-bearing: `status`
 * pinned to the value we READ means a row that has since been SENT is not
 * dragged back (the unguarded version matched on `id` alone and reverted
 * committed sends, leaving a row claiming QUEUED with a `sent_at`), and
 * `updatedAt < cutoff` means a row a concurrent sweep already re-queued — whose
 * `updated_at` is now — is not re-queued a second time.
 */
async function requeue(
  client: NotificationsDb,
  row: NotificationDeliveryRow,
  cutoff: Date,
): Promise<boolean> {
  const moved = await client.notificationDelivery.updateMany({
    where: { id: row.id, status: row.status as DeliveryStatus, updatedAt: { lt: cutoff } },
    data: { status: 'QUEUED' },
  });
  return moved.count === 1;
}

/**
 * Retry sweep for a cron/admin trigger: re-dispatch deliveries that have not
 * moved in `olderThanMs`.
 *
 * BOUNDED by `take`, deliberately. Unbounded, a 2 000-row outage backlog is a
 * single run that takes minutes of sequential provider round trips — outliving
 * its own cron interval, so the next tick starts while it is still working. The
 * claim makes that overlap harmless; the bound makes it rare.
 */
export async function drainPending(
  deps: NotificationDispatchDeps,
  olderThanMs: number,
  take: number,
): Promise<{ dispatched: number }> {
  const client = await deps.db();
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await client.notificationDelivery.findMany({
    where: { status: { in: RETRYABLE }, updatedAt: { lt: cutoff } },
    orderBy: { updatedAt: 'asc' },
    take,
  });

  const notificationIds = new Set<string>();
  for (const row of stale) {
    if (await requeue(client, row, cutoff)) notificationIds.add(row.notificationId);
  }

  let dispatched = 0;
  for (const id of notificationIds) {
    // Isolated per notification: an unreachable host seam on one of them must
    // not cost every later row in the batch its retry.
    try {
      dispatched += await dispatchOne(deps, id);
    } catch (error) {
      deps.logger.error(`[notifications] sweep failed to dispatch ${id}:`, error);
    }
  }
  return { dispatched };
}
