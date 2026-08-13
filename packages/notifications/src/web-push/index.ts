import webpush from 'web-push';

import type { WebPushSender, WebPushSubscription } from '../server/transports/web-push';

/**
 * `@12-apps/notifications/web-push` — the VAPID sender, behind its own subpath.
 *
 * VAPID signing and RFC 8291 payload encryption need the `web-push` package: a
 * node-only dependency with its own crypto surface, which a host that never
 * turns the channel on must not be made to install. So it is an OPTIONAL peer
 * reached only through this subpath — the same arrangement `./hono` has, and the
 * same reason `@12-apps/payments-backend` keeps its adapters off its root entry.
 * Neither the root entry nor `./server` imports this file, so a bundle that
 * never mentions web push never resolves `web-push`.
 *
 * The host's whole wiring:
 *
 *     import { vapidPushSender } from '@12-apps/notifications/web-push';
 *
 *     transports: [
 *       {
 *         channel: 'WEB_PUSH',
 *         driver: 'vapid',
 *         publicKey: env.VAPID_PUBLIC_KEY,
 *         sender: vapidPushSender({
 *           subject: env.VAPID_SUBJECT,
 *           publicKey: env.VAPID_PUBLIC_KEY,
 *           privateKey: env.VAPID_PRIVATE_KEY,
 *         }),
 *       },
 *     ]
 *
 * Generate the key pair once with `npx web-push generate-vapid-keys`; `subject`
 * is the `mailto:` or https contact URL the push services require.
 */

export interface VapidPushSenderConfig {
  /** `mailto:ops@example.com` or an https contact URL. */
  subject: string;
  publicKey: string;
  privateKey: string;
}

/**
 * A signer for the WEB_PUSH transport.
 *
 * Errors pass through UNWRAPPED, and that is load-bearing: `web-push` rejects
 * with an error carrying `statusCode`, and the transport reads it to tell a GONE
 * subscription (404/410, prune it) from a transient failure (keep it, record the
 * error, retry on the next sweep). Wrapping the error would turn the prune into
 * a no-op and let dead subscriptions accumulate forever.
 */
export function vapidPushSender(config: VapidPushSenderConfig): WebPushSender {
  if (!config.subject || !config.publicKey || !config.privateKey) {
    throw new Error(
      'vapidPushSender() needs `subject`, `publicKey` and `privateKey` — a partially ' +
        'configured signer would fail on the first real send instead of at boot.',
    );
  }
  return async (subscription: WebPushSubscription, payload: string): Promise<void> => {
    // Set per send rather than once at module load: a process may hold two
    // mounts (a platform sender and a tenant sender), and `web-push` keeps the
    // details in module state.
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: subscription.keys },
      payload,
    );
  };
}
