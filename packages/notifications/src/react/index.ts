/**
 * `@12-apps/notifications/react` — the frontend half (12-15).
 *
 * One factory, `createWebNotifications({ apiBase })`, and everything it returns
 * is already bound to one shared store and one copy table. The individual
 * pieces are exported too, for a host composing its own chrome — but a host that
 * only wants the feature needs the factory and nothing else.
 */

export {
  createWebNotifications,
  type NotificationsWebConfig,
  type WebNotifications,
} from './create-web-notifications';

export { BellIcon } from './bell-icon';
export type { BellButtonProps } from './bell-button';
export type { NotificationsPanelProps } from './panel';
export type { PreferencesScreenProps } from './preferences-screen';
export type { WebPushPlatformHint, WebPushSetupConfig } from './web-push-setup';

export {
  createNotificationsApiClient,
  type NotificationsApiClient,
  type PreferencesPayload,
  type PushRegistrationPayload,
} from './api';

export {
  BADGE_POLL_MS,
  BADGE_RECONCILE_MS,
  PAGE_SIZE,
  createInboxStore,
  type InboxListStatus,
  type InboxState,
  type InboxStore,
} from './inbox-state';

export {
  useInboxList,
  useInboxState,
  useUnreadCount,
  type NotificationsSignalHook,
  type NotificationsSubscribe,
} from './hooks';

export { LiveActivityCard, type LiveActivityCardProps } from './live-card';
export {
  type LiveActivitiesConfig,
  type LiveActivitiesHook,
  type LiveActivityMessages,
} from './live-config';
export { LiveSection, type LiveSectionProps } from './live-section';

export { relativeTime } from './relative-time';

export {
  NotificationsHttpError,
  httpNotificationsTransport,
  type NotificationsResult,
  type NotificationsTransport,
} from './transport';

export {
  disableWebPush,
  enableWebPush,
  getExistingPushSubscription,
  pushSupported,
  type PushSetupResult,
} from './web-push-client';
