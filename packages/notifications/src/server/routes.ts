import type { NotificationWireMessages } from '../messages';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from '../types';

import {
  guarded,
  ok,
  parseDeleteBody,
  parseListQuery,
  parseMarkReadBody,
  parsePreferencesBody,
  parsePushEndpointBody,
  parsePushEndpointQuery,
  parsePushSubscriptionBody,
  type NotificationsRoute,
} from './context';
import type { NotificationContactDirectory } from './db';
import type { NotificationInboxStore } from './inbox';
import type { NotificationPreferenceStore } from './preferences';
import type { PushSubscriptionStore } from './push-subscriptions';
import type { TransportRegistry } from './transports/registry';

/**
 * The endpoints, as framework-neutral descriptors (12-15).
 *
 * Nine routes, and the paths are the PACKAGE's: the shipped react client
 * builds these URLs, so a host that renamed one would be a host whose own bell
 * stopped working. The host names only where the whole block is mounted
 * (the origin mounts it at `/api/account`).
 *
 * Route ORDER is preserved by every adapter. Nothing here is shaped `/:id`, so
 * no sibling can capture a literal — but the order is still the contract,
 * because that is what a host mounting an `/:id` route of its own under the
 * same prefix has to reason about.
 */

interface NotificationRoutesDeps {
  inbox: NotificationInboxStore;
  preferences: NotificationPreferenceStore;
  pushSubscriptions: PushSubscriptionStore;
  transports: TransportRegistry;
  contacts: NotificationContactDirectory;
  categories: readonly string[];
  messages: NotificationWireMessages;
  /** Told when a write actually changed something (for a realtime hint). */
  onInboxChanged?: (userId: string) => void;
}

/**
 * Whether each channel CAN reach this user right now — destination on file and
 * the channel declared — so the settings UI can disable dead toggles with a
 * hint (no phone → SMS/WhatsApp off).
 *
 * Web push is probed with a HYPOTHETICAL subscription: for the SETTINGS screen
 * the channel is "available" when the platform can send at all, because the
 * browser subscribe step happens right from that toggle. Requiring an existing
 * subscription here would deadlock the UX.
 */
async function channelAvailability(
  deps: NotificationRoutesDeps,
  userId: string,
): Promise<Record<NotificationChannel, boolean>> {
  const contact = await deps.contacts.getContact(userId);
  const recipient = {
    userId,
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    pushSubscriptionCount: 1,
  };
  return Object.fromEntries(
    NOTIFICATION_CHANNELS.map((channel) => [
      channel,
      deps.transports.get(channel)?.supports(recipient) ?? false,
    ]),
  ) as Record<NotificationChannel, boolean>;
}

/** The `{ preferences, availability, categories }` payload both prefs routes answer. */
async function preferencesPayload(
  deps: NotificationRoutesDeps,
  userId: string,
): Promise<{
  preferences: Record<string, Record<string, boolean>>;
  availability: Record<NotificationChannel, boolean>;
  categories: string[];
}> {
  const [preferences, availability] = await Promise.all([
    deps.preferences.get(userId),
    channelAvailability(deps, userId),
  ]);
  // `categories` travels with the matrix so the settings screen renders the
  // HOST's taxonomy without being told it twice (once in the api config, once
  // in the web config) — the two could then disagree.
  return { preferences, availability, categories: [...deps.categories] };
}

function inboxRoutes(deps: NotificationRoutesDeps): NotificationsRoute[] {
  return [
    {
      method: 'GET',
      path: '/notifications',
      handle: guarded(async ({ actor, query }) =>
        ok(await deps.inbox.list(actor.userId, parseListQuery(query, deps.messages))),
      ),
    },
    {
      method: 'GET',
      path: '/notifications/unread-count',
      handle: guarded(async ({ actor }) =>
        // Polled by the SPAs, so it stays a single indexed COUNT.
        ok({ count: await deps.inbox.unreadCount(actor.userId) }),
      ),
    },
    {
      method: 'POST',
      path: '/notifications/mark-read',
      handle: guarded(async ({ actor, body }) => {
        const target = parseMarkReadBody(body, deps.messages);
        const updated =
          'all' in target
            ? await deps.inbox.markAllRead(actor.userId)
            : await deps.inbox.markRead(actor.userId, target.ids);
        // Only when something actually flipped. This endpoint is idempotent, so
        // a re-send of an already-read id reports `updated: 0` and has changed
        // nothing — hinting on that would wake every one of this user's devices
        // to re-read a badge that did not move.
        if (updated > 0) deps.onInboxChanged?.(actor.userId);
        return ok({ updated });
      }),
    },
    {
      method: 'POST',
      // POST, not DELETE, because the ids travel in a JSON body.
      path: '/notifications/delete',
      handle: guarded(async ({ actor, body }) => {
        const deleted = await deps.inbox.softDelete(
          actor.userId,
          parseDeleteBody(body, deps.messages),
        );
        // Same rule as mark-read. A delete can move the badge too — an UNREAD
        // row that is removed takes its place in the count with it.
        if (deleted > 0) deps.onInboxChanged?.(actor.userId);
        return ok({ deleted });
      }),
    },
  ];
}

function preferenceRoutes(deps: NotificationRoutesDeps): NotificationsRoute[] {
  return [
    {
      method: 'GET',
      path: '/notification-preferences',
      handle: guarded(async ({ actor }) => ok(await preferencesPayload(deps, actor.userId))),
    },
    {
      method: 'PUT',
      path: '/notification-preferences',
      handle: guarded(async ({ actor, body }) => {
        // The dispatch pipeline reads these on every emit, so a save takes
        // effect immediately — no cache to invalidate.
        await deps.preferences.save(actor.userId, parsePreferencesBody(body, deps.messages));
        return ok(await preferencesPayload(deps, actor.userId));
      }),
    },
  ];
}

function pushRoutes(deps: NotificationRoutesDeps): NotificationsRoute[] {
  return [
    {
      method: 'GET',
      path: '/push-subscriptions',
      handle: guarded(async ({ actor, query }) => {
        const endpoint = parsePushEndpointQuery(query, deps.messages);
        return ok({
          // null = web push is not configured on this deployment.
          vapidPublicKey: deps.transports.webPushPublicKey(),
          count: await deps.pushSubscriptions.count(actor.userId),
          // Only when asked. `registered` is what lets the settings screen stop
          // trusting the browser alone: a re-owned or pruned row answers false,
          // so the screen offers *Ativar* again instead of claiming all is well.
          ...(endpoint !== undefined
            ? { registered: await deps.pushSubscriptions.isRegisteredTo(actor.userId, endpoint) }
            : {}),
        });
      }),
    },
    {
      method: 'POST',
      path: '/push-subscriptions',
      handle: guarded(async ({ actor, body, headers }) => {
        const input = parsePushSubscriptionBody(body, deps.messages);
        const userAgent = headers?.['user-agent'];
        await deps.pushSubscriptions.save(actor.userId, {
          ...input,
          ...(userAgent ? { userAgent } : {}),
        });
        return ok({ count: await deps.pushSubscriptions.count(actor.userId) });
      }),
    },
    {
      method: 'DELETE',
      // The endpoint is a long opaque URL, unusable as a path param.
      path: '/push-subscriptions',
      handle: guarded(async ({ actor, body }) => {
        await deps.pushSubscriptions.remove(
          actor.userId,
          parsePushEndpointBody(body, deps.messages),
        );
        return ok({ count: await deps.pushSubscriptions.count(actor.userId) });
      }),
    },
  ];
}

export function notificationRoutes(deps: NotificationRoutesDeps): NotificationsRoute[] {
  return [...inboxRoutes(deps), ...preferenceRoutes(deps), ...pushRoutes(deps)];
}
