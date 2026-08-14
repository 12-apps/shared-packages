/**
 * `@12-apps/notifications` — the channel-agnostic notification system: an
 * always-on in-app inbox, per-user × per-category channel preferences, and
 * pluggable email / SMS / WhatsApp / web-push transports behind vendor
 * drivers (12-15).
 *
 * This ROOT entry is the framework-free, storage-free core: the types, the
 * generator registry, the preference policy and the phone rules. It imports
 * nothing that a browser cannot run and touches no database, which is what
 * lets the react half share the vocabulary with the server half instead of
 * restating it.
 *
 * The two halves each have ONE factory:
 *
 *     import { createApiNotifications } from '@12-apps/notifications/server';
 *     import { createWebNotifications } from '@12-apps/notifications/react';
 *
 * plus `@12-apps/notifications/hono` to mount the backend on Hono and
 * `@12-apps/notifications/web-push` for the VAPID sender (which is the only
 * piece that needs the `web-push` package, hence its own subpath).
 */

export {
  NOTIFICATION_CHANNELS,
  taxonomyOf,
  type DeliveryStatus,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationContent,
  type NotificationEvent,
  type NotificationGenerator,
  type NotificationLogger,
  type NotificationRecipient,
  type NotificationTaxonomy,
  type NotificationTransport,
  type TransportRecipient,
} from './types';

export {
  UnknownNotificationRecipientError,
  UnknownNotificationTypeError,
} from './errors';

export {
  createGeneratorRegistry,
  type NotificationGeneratorRegistry,
} from './generators';

export {
  DEFAULT_CHANNEL_ROW,
  defaultChannelMatrix,
  enabledChannelsOf,
  mergeChoices,
  mergeStoredRow,
  type ChannelMatrix,
  type ChannelRow,
} from './preferences-core';

export { normalizePhoneE164, type PhoneNormalizeOptions } from './phone';

export {
  DEFAULT_NOTIFICATION_MESSAGES,
  messagesOf,
  type NotificationMessages,
} from './messages';

export {
  inboxWire,
  type InboxNotification,
  type ListNotificationsResult,
  type NotificationRow,
} from './wire';
