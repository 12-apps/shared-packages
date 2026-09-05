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

// `LiveActivityCard` is deliberately NOT exported. It takes the clock as a
// prop, and the minute tick that produces one lives in `LiveSection` — so an
// external composer would either reimplement the tick or pass `Date.now()` once
// and get the frozen timestamp `relative-time.ts` was changed to prevent.
// `LiveSection` is the composable unit and carries its own clock.
export {
  type LiveActivitiesConfig,
  type LiveActivitiesHook,
  type LiveActivityMessages,
} from './live-config';

/**
 * The contract itself, re-exported from the entry a host WIRES through.
 *
 * It lives in the root, because both halves need it and neither owns it — but a
 * host writing `useActivities` imports the seam from `./react` and then has to
 * reach into a second entry for the one type that seam returns. Measured on the
 * first adopter: a `LiveActivity` imported from here failed to compile with
 * "declares 'LiveActivity' locally, but it is not exported", which is a
 * confusing way to say "you wanted the other subpath".
 */
export {
  liveActivityLane,
  type LiveActivity,
  type LiveActivityLane,
  type LiveActivityStep,
} from '../live';
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
