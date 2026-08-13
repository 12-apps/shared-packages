/**
 * `@12-apps/notifications/server` — the host-mounted backend half (12-15).
 *
 * Server-only: the transports reach for `Buffer` and the network. Everything a
 * browser also needs (types, the preference policy, the wire shape, the copy)
 * lives in the root entry and is re-exported by neither half, so the two can
 * never drift into two vocabularies.
 */

export {
  createApiNotifications,
  type ApiNotifications,
  type NotificationsServerConfig,
} from './create-api-notifications';

export {
  NotificationsApiError,
  foldApiError,
  ok,
  type NotificationsActor,
  type NotificationsRequest,
  type NotificationsResponse,
  type NotificationsRoute,
} from './context';

export type {
  NotificationContactDirectory,
  NotificationCreateData,
  NotificationDelegate,
  NotificationDeliveryDelegate,
  NotificationDeliveryRow,
  NotificationDeliveryWhere,
  NotificationPageAfter,
  NotificationPreferenceDelegate,
  NotificationPreferenceRow,
  NotificationWhere,
  NotificationsDb,
  NotificationsDbClient,
  NotificationsDbProvider,
  PushSubscriptionDelegate,
  PushSubscriptionRow,
} from './db';

export type { ListNotificationsInput, NotificationInboxStore } from './inbox';
export type { NotificationPreferenceStore } from './preferences';
export type { PushSubscriptionInput, PushSubscriptionStore } from './push-subscriptions';

export type {
  CommittedNotification,
  NotificationChannelPolicy,
  NotificationCommittedListener,
  NotificationDispatchScheduler,
  NotificationRouter,
  NotifyOptions,
  NotifyResult,
} from './router';

export type {
  NotificationAudienceDirectory,
  NotifyByPermission,
  PermissionNotificationResult,
  PermissionNotificationSkip,
} from './by-permission';

export {
  NotificationProviderError,
  absoluteLink,
  type DriverDeclarationBase,
  type FetchImpl,
} from './transports/drivers';

export {
  createTransportRegistry,
  type ExtraDrivers,
  type TransportDeclaration,
  type TransportRegistry,
} from './transports/registry';

export {
  EMAIL_DRIVERS,
  emailTransport,
  formatEmail,
  type EmailDriver,
  type EmailDriverDeclaration,
  type EmailMessage,
} from './transports/email';

export {
  SMS_DRIVERS,
  formatSms,
  smsTransport,
  type SmsDriver,
  type SmsDriverDeclaration,
  type SmsMessage,
} from './transports/sms';

export {
  WHATSAPP_DRIVERS,
  formatWhatsApp,
  whatsAppTransport,
  type WhatsAppDriver,
  type WhatsAppDriverDeclaration,
  type WhatsAppMessage,
} from './transports/whatsapp';

export {
  WEB_PUSH_DRIVERS,
  formatWebPush,
  webPushTransport,
  type WebPushDriverDeclaration,
  type WebPushMessage,
  type WebPushSender,
  type WebPushSubscription,
  type WebPushSubscriptionSource,
} from './transports/web-push';
