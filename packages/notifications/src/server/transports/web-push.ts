import type {
  NotificationContent,
  NotificationLogger,
  NotificationTransport,
  TransportRecipient,
} from '../../types';

import { resolveDriver, type DriverDeclarationBase } from './drivers';

/**
 * WEB_PUSH transport — browser alerts over the Web Push protocol.
 *
 * What is the PACKAGE's, and stays here: the payload the service worker
 * renders, the fan-out to every one of the user's browsers, the 404/410 PRUNE
 * that makes `push_subscriptions` self-heal, and the rule that a send succeeds
 * when at least one subscription accepted it and fails only when all errored.
 *
 * What is the VENDOR's, and crosses as a port: VAPID signing and RFC 8291
 * payload encryption. Those need the `web-push` package, a node-only
 * dependency this package must not force on a host that never enables the
 * channel — so `@12-apps/notifications/web-push` exports the sender behind its
 * own subpath and an optional peer, exactly as `./hono` does for the adapter.
 *
 *   - `driver: 'vapid'` — `sender: vapidPushSender({ subject, publicKey,
 *     privateKey })` from that subpath (or any other signer).
 *   - `driver: 'log'` — dev driver: logs instead of sending.
 *   - no WEB_PUSH declaration — channel unavailable, router skips it.
 */

/** One browser subscription, as `PushManager.subscribe()` yields it. */
export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * The vendor seam: sign + encrypt + POST one payload to one push service.
 *
 * MUST reject with an error carrying a numeric `statusCode` when the push
 * service answers one — that is how a gone subscription (404/410) is told
 * apart from a transient failure, and therefore what makes the prune correct
 * rather than destructive.
 */
export type WebPushSender = (
  subscription: WebPushSubscription,
  payload: string,
) => Promise<void>;

/** The channel message the Web Push formatter produces (the SW's payload). */
export interface WebPushMessage {
  title: string;
  body: string;
  link: string | null;
  data: Record<string, unknown>;
}

export interface WebPushDriverDeclaration extends DriverDeclarationBase {
  channel: 'WEB_PUSH';
  /** Required by the `vapid` driver: the signer. */
  sender?: WebPushSender;
  /**
   * The VAPID PUBLIC key, served to the browser by
   * `GET <mount>/push-subscriptions` so the client can subscribe. Public by
   * definition — the private key never crosses into this declaration.
   */
  publicKey?: string;
  logger?: NotificationLogger;
}

/** The subscriptions the transport reads and prunes (db-backed by the mount). */
export interface WebPushSubscriptionSource {
  list(userId: string): Promise<{ id: string; endpoint: string; p256dh: string; auth: string }[]>;
  prune(id: string): Promise<void>;
}

const vapidDriver = (declaration: WebPushDriverDeclaration): WebPushSender => {
  const sender = declaration.sender;
  if (!sender) {
    throw new Error(
      'The vapid web-push driver needs a `sender` — import `vapidPushSender` from ' +
        '@12-apps/notifications/web-push.',
    );
  }
  return sender;
};

const logWebPushDriver =
  (declaration: WebPushDriverDeclaration): WebPushSender =>
  (_subscription, payload) => {
    // No endpoint logged: a push endpoint is a bearer capability for that
    // browser, so it is a secret in exactly the way an e-mail address is PII.
    declaration.logger?.info(
      `[notifications:web-push] log driver suppressed a real send (${payload.length} bytes)`,
    );
    return Promise.resolve();
  };

export const WEB_PUSH_DRIVERS: Record<
  string,
  (declaration: WebPushDriverDeclaration) => WebPushSender
> = {
  vapid: vapidDriver,
  log: logWebPushDriver,
};

/** Status codes that mean "this subscription no longer exists — prune it". */
const GONE_STATUSES = new Set([404, 410]);

function statusCodeOf(error: unknown): number | null {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const code = (error as { statusCode: unknown }).statusCode;
    return typeof code === 'number' ? code : null;
  }
  return null;
}

export function formatWebPush(content: NotificationContent): WebPushMessage {
  return {
    title: content.title,
    body: content.body,
    link: content.link ?? null,
    data: content.data ?? {},
  };
}

export function webPushTransport(
  declaration: WebPushDriverDeclaration,
  subscriptions: WebPushSubscriptionSource,
  extraDrivers: Record<string, (d: WebPushDriverDeclaration) => WebPushSender> = {},
): NotificationTransport<WebPushMessage> {
  const send = resolveDriver('WEB_PUSH', declaration, {
    ...WEB_PUSH_DRIVERS,
    ...extraDrivers,
  });
  return {
    channel: 'WEB_PUSH',
    supports: (recipient: TransportRecipient) => recipient.pushSubscriptionCount > 0,
    format: formatWebPush,
    async send(message, recipient) {
      const rows = await subscriptions.list(recipient.userId);
      if (rows.length === 0) throw new Error('Recipient no longer has push subscriptions.');
      const payload = JSON.stringify(message);
      let delivered = 0;
      let lastError: unknown = null;
      for (const row of rows) {
        try {
          await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload);
          delivered += 1;
        } catch (error) {
          const status = statusCodeOf(error);
          if (status !== null && GONE_STATUSES.has(status)) {
            // Expired/unsubscribed browser — prune so future sends skip it.
            await subscriptions.prune(row.id).catch(() => {
              /* already pruned by a concurrent send */
            });
          } else {
            lastError = error;
          }
        }
      }
      if (delivered === 0) {
        throw lastError instanceof Error
          ? lastError
          : new Error('No push subscription accepted the payload.');
      }
    },
  };
}
