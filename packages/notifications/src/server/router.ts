import { UnknownNotificationRecipientError } from '../errors';
import type { NotificationGeneratorRegistry } from '../generators';
import type {
  NotificationChannel,
  NotificationEvent,
  NotificationLogger,
  TransportRecipient,
} from '../types';

import type { NotificationContactDirectory, NotificationsDbProvider } from './db';
import type { NotificationPreferenceStore } from './preferences';
import type { PushSubscriptionStore } from './push-subscriptions';
import type { TransportRegistry } from './transports/registry';

/**
 * The channel router + the `notify` emit API — the single front door into the
 * pipeline. Any server-side caller (route handler, background worker, agent
 * tool) emits with one typed call and zero knowledge of channels, formatting,
 * or preferences:
 *
 *     await notifications.notify({ type: 'order.paid', recipient: { userId }, payload });
 *
 * What one emit does:
 *   1. Resolves the registered generator for `type` → agnostic content.
 *   2. ALWAYS writes the inbox record (the always-on channel), atomically
 *      with…
 *   3. …one QUEUED delivery per channel that is (a) enabled by the recipient's
 *      preferences for the generator's category and (b) supported by its
 *      transport for this recipient (destination exists + channel declared).
 *   4. Hands the deliveries to the transports ASYNCHRONOUSLY (fire-and-forget
 *      by default) so emit sites never block on provider I/O.
 *
 * Failure isolation: each delivery is sent in its own try/catch — one channel
 * failing marks only its row FAILED (error recorded) and never blocks the
 * inbox record or the other channels. Delivery is at-least-once: the unique
 * (notification, channel) row makes fan-out idempotent, and a re-dispatch of a
 * QUEUED/FAILED row may re-send if a crash landed between the provider call
 * and the SENT flip — transports are required to tolerate that.
 *
 * Queueing: in-process async dispatch by default, or a real queue when the
 * host passes `scheduleDispatch`. The QUEUED status + the drain sweep are what
 * make either safe — the delivery rows are the durable record, so a queue that
 * is unavailable (or absent) costs latency, never a notification.
 */

/**
 * Which channels a TENANT may use, decided per emit — the host's plan gate.
 *
 * A `null`/absent clientId is a PLATFORM notification (password resets,
 * operator alerts) and is never policy-filtered. With no policy installed
 * every channel passes.
 */
export type NotificationChannelPolicy = (
  clientId: string,
  channels: readonly NotificationChannel[],
) => Promise<NotificationChannel[]> | NotificationChannel[];

/** How the host defers dispatch of one already-committed notification. */
export type NotificationDispatchScheduler = (notificationId: string) => Promise<void>;

/** One committed inbox record, as the commit observer sees it. */
export interface CommittedNotification {
  notificationId: string;
  /** The owner — the only field a user-scoped fan-out needs. */
  userId: string;
  /** The tenant the row was stamped with, or null for a platform emit. */
  clientId: string | null;
}

/**
 * Told about each inbox record the moment it commits. Synchronous and
 * `void`-returning by contract: an observer may not make an emit site wait,
 * and may not fail one.
 *
 * It exists because the inbox record is written HERE, in the package, while the
 * thing that usually wants to know — a realtime bus — is a dependency this
 * package does not have and should not gain. Placing it at the funnel rather
 * than at the emit sites is the point: `notify` is the single front door, so
 * every sender is covered by construction, including ones written later.
 */
export type NotificationCommittedListener = (notification: CommittedNotification) => void;

/** Options for `notify`. */
export interface NotifyOptions {
  /**
   * Await transport dispatch instead of fire-and-forget. For tests and
   * worker/cron contexts where the process may exit right after emitting.
   */
  sync?: boolean;
}

/** What `notify` resolves with (dispatch may still be in flight). */
export interface NotifyResult {
  notificationId: string;
  /** Channels a delivery row was enqueued for (preference ∩ transport gate). */
  channels: NotificationChannel[];
}

interface NotificationRouterDeps {
  db: NotificationsDbProvider;
  generators: NotificationGeneratorRegistry;
  transports: TransportRegistry;
  preferences: NotificationPreferenceStore;
  pushSubscriptions: PushSubscriptionStore;
  contacts: NotificationContactDirectory;
  logger: NotificationLogger;
  channelPolicy?: NotificationChannelPolicy;
  scheduleDispatch?: NotificationDispatchScheduler;
  onCommitted?: NotificationCommittedListener;
}

export interface NotificationRouter {
  notify<TPayload>(
    event: NotificationEvent<TPayload>,
    options?: NotifyOptions,
  ): Promise<NotifyResult>;
  dispatchDeliveries(notificationId: string): Promise<void>;
  drainPending(olderThanMs?: number): Promise<{ dispatched: number }>;
}

/**
 * Apply the host's policy. Fail-open by design: a policy error must cost at
 * worst an extra notification, never silently drop a whole emit — the dunning
 * e-mail this system carries is how payment gets collected.
 */
async function applyPolicy(
  deps: NotificationRouterDeps,
  clientId: string | null | undefined,
  channels: NotificationChannel[],
): Promise<NotificationChannel[]> {
  if (!deps.channelPolicy || clientId === null || clientId === undefined) return channels;
  try {
    return await deps.channelPolicy(clientId, channels);
  } catch {
    return channels;
  }
}

/** Load the recipient's destinations once, for every transport's gate. */
async function loadRecipient(
  deps: NotificationRouterDeps,
  userId: string,
): Promise<TransportRecipient | null> {
  const contact = await deps.contacts.getContact(userId);
  if (!contact) return null;
  return {
    userId,
    email: contact.email,
    phone: contact.phone,
    pushSubscriptionCount: await deps.pushSubscriptions.count(userId),
  };
}

/** Run the commit observer without ever letting it reach the caller. */
function announce(deps: NotificationRouterDeps, notification: CommittedNotification): void {
  if (!deps.onCommitted) return;
  try {
    deps.onCommitted(notification);
  } catch (error) {
    // An observer is an accelerator, never a step. The row is committed; a
    // listener that throws must not turn a delivered notification into a 500.
    deps.logger.error(
      `[notifications] commit listener failed for ${notification.notificationId}:`,
      error,
    );
  }
}

/**
 * Send every still-QUEUED delivery of one notification through its transport,
 * flipping each row to SENT (with `sentAt`) or FAILED (with the provider error).
 * Safe to call repeatedly — already-SENT rows are skipped.
 */
async function dispatchOne(deps: NotificationRouterDeps, notificationId: string): Promise<void> {
  const client = await deps.db();
  const notification = await client.notification.findUnique({ where: { id: notificationId } });
  if (!notification) return;
  const queued = await client.notificationDelivery.findMany({
    where: { notificationId, status: 'QUEUED' },
  });
  if (queued.length === 0) return;

  const recipient = await loadRecipient(deps, notification.userId);
  if (!recipient) return;

  const content = {
    title: notification.title,
    body: notification.body,
    ...(notification.link !== null ? { link: notification.link } : {}),
    data: (notification.data ?? {}) as Record<string, unknown>,
  };

  // Sequential on purpose: one recipient's channels (2–4 sends) gain little
  // from parallelism, and providers rate-limit per sender anyway.
  for (const delivery of queued) {
    const transport = deps.transports.get(delivery.channel as NotificationChannel);
    try {
      if (!transport) throw new Error(`No transport declared for ${delivery.channel}.`);
      await transport.send(transport.format(content) as never, recipient);
      await client.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENT', sentAt: new Date(), error: null },
      });
    } catch (error) {
      await client.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'FAILED', error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

/** The channels one emit will actually enqueue: preference ∩ transport ∩ plan. */
async function resolveChannels(
  deps: NotificationRouterDeps,
  event: NotificationEvent<unknown>,
  category: string,
  recipient: TransportRecipient,
): Promise<NotificationChannel[]> {
  const enabled = await deps.preferences.enabledChannels(event.recipient.userId, category);
  const supported = enabled.filter((channel) => {
    const transport = deps.transports.get(channel);
    return transport !== null && transport.supports(recipient);
  });
  // The host's plan gate: a tenant-scoped emit keeps only the channels the
  // tenant's plan covers, so a revoked transport DEGRADES to the remaining ones
  // rather than dropping the notification silently.
  return applyPolicy(deps, event.recipient.clientId, supported);
}

/** Commit the inbox record and its delivery rows together, in one transaction. */
async function commit(
  deps: NotificationRouterDeps,
  event: NotificationEvent<unknown>,
  category: string,
  content: { title: string; body: string; link?: string; data?: Record<string, unknown> },
  channels: NotificationChannel[],
): Promise<{ id: string; userId: string; clientId: string | null }> {
  const client = await deps.db();
  return client.$transaction(async (tx) => {
    const created = await tx.notification.create({
      data: {
        userId: event.recipient.userId,
        clientId: event.recipient.clientId ?? null,
        type: event.type,
        category,
        title: content.title,
        body: content.body,
        link: content.link ?? null,
        data: content.data ?? {},
      },
    });
    if (channels.length > 0) {
      await tx.notificationDelivery.createMany({
        data: channels.map((channel) => ({ notificationId: created.id, channel })),
        // Idempotence backstop: the unique (notification, channel) key.
        skipDuplicates: true,
      });
    }
    return created;
  });
}

/**
 * Retry sweep for a cron/admin trigger: re-dispatch FAILED deliveries and QUEUED
 * strays older than `olderThanMs` (a QUEUED row that old means its emitting
 * process died mid-dispatch). FAILED rows are flipped back to QUEUED first so the
 * per-notification dispatcher picks them up.
 */
async function drainPending(
  deps: NotificationRouterDeps,
  olderThanMs: number,
): Promise<{ dispatched: number }> {
  const client = await deps.db();
  const cutoff = new Date(Date.now() - olderThanMs);
  const pending = await client.notificationDelivery.findMany({
    where: {
      OR: [
        { status: 'FAILED', updatedAt: { lt: cutoff } },
        { status: 'QUEUED', createdAt: { lt: cutoff } },
      ],
    },
  });
  if (pending.length === 0) return { dispatched: 0 };

  const failedIds = pending.filter((row) => row.status === 'FAILED').map((row) => row.id);
  if (failedIds.length > 0) {
    await client.notificationDelivery.updateMany({
      where: { id: { in: failedIds } },
      data: { status: 'QUEUED' },
    });
  }

  const notificationIds = [...new Set(pending.map((row) => row.notificationId))];
  for (const id of notificationIds) {
    await dispatchOne(deps, id);
  }
  return { dispatched: pending.length };
}

export function createNotificationRouter(deps: NotificationRouterDeps): NotificationRouter {
  return {
    dispatchDeliveries: (notificationId) => dispatchOne(deps, notificationId),
    drainPending: (olderThanMs = 5 * 60_000) => drainPending(deps, olderThanMs),

    async notify(event, options = {}) {
      const generator = deps.generators.resolve(event.type);
      const content = generator.generate(event.payload as never);

      const recipient = await loadRecipient(deps, event.recipient.userId);
      if (!recipient) throw new UnknownNotificationRecipientError(event.recipient.userId);

      const channels = await resolveChannels(deps, event, generator.category, recipient);
      const notification = await commit(deps, event, generator.category, content, channels);

      // AFTER the transaction, never inside it: a subscriber woken by an event
      // published mid-transaction would re-read and not find the row it was told
      // about — the classic read-your-own-hint race.
      announce(deps, {
        notificationId: notification.id,
        userId: notification.userId,
        clientId: notification.clientId,
      });

      // `sync` always means "send it here, now" — a test or a worker about to
      // exit must not have its send handed to a queue it will never drain.
      if (options.sync) {
        await dispatchOne(deps, notification.id);
        return { notificationId: notification.id, channels };
      }

      void (
        deps.scheduleDispatch
          ? deps.scheduleDispatch(notification.id)
          : dispatchOne(deps, notification.id)
      ).catch((error: unknown) => {
        // Detached-path backstop only: per-delivery failures are already
        // recorded on their rows; this catches infrastructure errors.
        deps.logger.error(`[notifications] dispatch failed for ${notification.id}:`, error);
      });

      return { notificationId: notification.id, channels };
    },
  };
}
