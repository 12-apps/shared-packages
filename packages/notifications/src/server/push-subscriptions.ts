import type { NotificationsDbProvider } from './db';
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
}

export interface PushSubscriptionStore extends WebPushSubscriptionSource {
  /**
   * Register (or refresh) one browser's subscription. Upserts on the globally
   * unique endpoint, so re-subscribing the same browser never duplicates — and
   * an endpoint recycled to a different signed-in user is re-owned by them.
   */
  save(userId: string, input: PushSubscriptionInput): Promise<void>;
  /** Remove one browser's subscription (owner-scoped; unknown = no-op). */
  remove(userId: string, endpoint: string): Promise<void>;
  /** How many devices the user has registered (settings UI hint). */
  count(userId: string): Promise<number>;
}

export function createPushSubscriptionStore(
  db: NotificationsDbProvider,
): PushSubscriptionStore {
  return {
    async save(userId, input) {
      const client = await db();
      await client.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: {
          userId,
          endpoint: input.endpoint,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent ?? null,
        },
        update: {
          userId,
          p256dh: input.keys.p256dh,
          auth: input.keys.auth,
          userAgent: input.userAgent ?? null,
        },
      });
    },

    async remove(userId, endpoint) {
      const client = await db();
      await client.pushSubscription.deleteMany({ where: { userId, endpoint } });
    },

    async count(userId) {
      const client = await db();
      return client.pushSubscription.count({ where: { userId } });
    },

    async list(userId) {
      const client = await db();
      const rows = await client.pushSubscription.findMany({ where: { userId } });
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
