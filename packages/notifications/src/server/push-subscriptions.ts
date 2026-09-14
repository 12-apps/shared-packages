import type { NotificationLogger } from '../types';

import type { NotificationsDbProvider, PushSubscriptionWhere } from './db';
import type { WebPushSubscriptionSource } from './transports/web-push';

/**
 * Browser push subscription registry — the write side of the Web Push
 * destination. The client obtains a `PushSubscription` from
 * `PushManager.subscribe()` (using the VAPID public key) and posts it here;
 * unsubscribe removes it by endpoint. All owner-scoped.
 */

/** What `PushSubscription.toJSON()` yields in the browser. */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Optional browser/device hint for a device list. */
  userAgent?: string;
  /**
   * Which ORIGIN this browser subscribed on — the HOST's resolved
   * value, never anything the caller sent. Absent/null = the platform origin.
   */
  clientId?: string | null;
}

/**
 * Which of a user's subscriptions one notification may reach.
 *
 * Stated as a rule on the SUBSCRIPTION rather than as a fallback, because the
 * fallback form ("the platform's rows only when the store's are absent")
 * silently changes the platform origin's behaviour, and a marketplace host must
 * be unaffected by this change:
 *
 * | the subscription was registered on | it receives |
 * |---|---|
 * | the PLATFORM origin (`client_id IS NULL`) | every notification — as today |
 * | store X's origin | store X's, and platform-wide ones (`clientId IS NULL`) |
 *
 * Nothing ever reaches a subscription registered on a DIFFERENT store's origin.
 * It follows without a special case that a store-B notification reaches a
 * customer who installed only store A through their PLATFORM subscription, and
 * through neither app.
 *
 * `notificationClientId` is the NOTIFICATION's tenant. `undefined` (nobody
 * asked to narrow) and `null` (a platform-wide notification) both mean every
 * row, which is why they share a branch.
 */
function reachableBy(
  userId: string,
  notificationClientId?: string | null,
): PushSubscriptionWhere {
  if (notificationClientId === undefined || notificationClientId === null) return { userId };
  return { userId, OR: [{ clientId: null }, { clientId: notificationClientId }] };
}

export interface PushSubscriptionStore extends WebPushSubscriptionSource {
  /**
   * Register (or refresh) one browser's subscription. Upserts on the globally
   * unique endpoint, so re-subscribing the same browser never duplicates — and
   * an endpoint recycled to a different signed-in user is re-owned by them.
   *
   * Re-owning is the right call and the alternative is worse: `PushManager`
   * returns the SAME endpoint for the same browser profile, so one row per
   * `(userId, endpoint)` would push user A's notifications to a browser now used
   * by B with B's own keys — which decrypt. Re-owning costs A their channel;
   * keeping both rows costs A their privacy. What re-owning must NOT do is
   * happen unrecorded, hence the warning.
   */
  save(userId: string, input: PushSubscriptionInput): Promise<void>;
  /** Remove one browser's subscription (owner-scoped; unknown = no-op). */
  remove(userId: string, endpoint: string): Promise<void>;
  /**
   * How many devices the user has registered.
   *
   * TWO callers with different questions. The settings screen asks unscoped —
   * "you have 2 devices" is a fact about the PERSON — and passes nothing. The
   * dispatch path passes the notification's tenant, because this is what
   * `supports()` gates on: left unscoped there, the router would enqueue a
   * WEB_PUSH delivery for a notification no reachable subscription exists for,
   * `send` would find an empty list and throw, and the sweep would burn every
   * attempt before writing DEAD — a FAILED row for something that was never
   * undeliverable, only out of scope.
   */
  count(userId: string, notificationClientId?: string | null): Promise<number>;
  /**
   * Whether THIS endpoint is currently registered to THIS user.
   *
   * The settings screen needs it because a browser's own subscription object is
   * not evidence that the server still has the row: a re-own or a 404/410 prune
   * removes the row while the browser keeps the subscription, and a screen that
   * reads only the browser then tells a user they are receiving alerts they will
   * never get again. `false` covers both "no such row" and "somebody else's
   * row", so an endpoint the caller does not own reveals nothing about who does.
   */
  isRegisteredTo(userId: string, endpoint: string): Promise<boolean>;
}

export function createPushSubscriptionStore(
  db: NotificationsDbProvider,
  logger?: NotificationLogger,
): PushSubscriptionStore {
  return {
    async save(userId, input) {
      const client = await db();
      const existing = await client.pushSubscription.findUnique({
        where: { endpoint: input.endpoint },
      });
      if (existing && existing.userId !== userId) {
        // No endpoint in the message: a push endpoint is a bearer capability for
        // that browser and must not reach logs. The two user ids are what makes
        // "user X stopped getting web push on a shared machine" answerable.
        logger?.error(
          `[notifications] push endpoint re-owned: user ${existing.userId} lost this ` +
            `browser's subscription to user ${userId}`,
        );
      }
      await client.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          clientId: input.clientId ?? null,
          userAgent: input.userAgent ?? null,
        },
        // Re-stamped on every save, so the same browser moving between a store's
        // app and the platform corrects its own scope rather than keeping the
        // first origin it ever subscribed from. A scope change on the SAME user
        // is not a re-own and must not log one.
        update: {
          userId,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          clientId: input.clientId ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    },

    async remove(userId, endpoint) {
      const client = await db();
      await client.pushSubscription.deleteMany({ where: { userId, endpoint } });
    },

    async count(userId, notificationClientId) {
      const client = await db();
      return client.pushSubscription.count({ where: reachableBy(userId, notificationClientId) });
    },

    async isRegisteredTo(userId, endpoint) {
      const client = await db();
      const row = await client.pushSubscription.findUnique({ where: { endpoint } });
      return row?.userId === userId;
    },

    async list(userId, notificationClientId) {
      const client = await db();
      const rows = await client.pushSubscription.findMany({
        where: reachableBy(userId, notificationClientId),
      });
      return rows.map((row) => ({
        id: row.id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
      }));
    },

    async prune(id) {
      const client = await db();
      await client.pushSubscription.delete({ where: { id } });
    },
  };
}
