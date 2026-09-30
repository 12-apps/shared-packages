import type { NotificationUnblockCopy } from '../../../copy';
import type { AlertVariant } from '../../data-display/Alert/Alert.types';

import type {
  NotificationBrowser,
  NotificationBrowserFamily,
  NotificationPlatform,
  NotificationStatus,
} from './NotificationStatusNotice.types';

/**
 * How loud each status is.
 *
 * `disabled` and `blocked` are warnings because the reader can do something
 * about them and will miss something if they do not. `unavailable` is only
 * information: there is nothing to act on, and painting it amber would ask the
 * reader to fix what they cannot.
 */
export const NOTICE_VARIANT: Record<NotificationStatus, AlertVariant> = {
  enabled: 'success',
  disabled: 'warning',
  blocked: 'warning',
  unavailable: 'info',
};

const platformOf = (userAgent: string, maxTouchPoints: number): NotificationPlatform => {
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  // iPadOS asks for the desktop site and reports itself as a Mac; the touch
  // points are what give it away.
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/android/i.test(userAgent)) return 'android';
  return 'desktop';
};

/**
 * Ordered most-specific first: every Chromium browser also says `Chrome`, and
 * every browser on iOS also says `Safari`.
 */
const FAMILY_PATTERNS: ReadonlyArray<readonly [NotificationBrowserFamily, RegExp]> = [
  ['samsung', /samsungbrowser/i],
  ['edge', /edg(e|a|ios)?\//i],
  ['opera', /opr\/|opera|opt\//i],
  ['firefox', /firefox\/|fxios\//i],
  ['chrome', /chrome\/|crios\//i],
  ['safari', /safari\//i],
];

const familyOf = (userAgent: string): NotificationBrowserFamily =>
  FAMILY_PATTERNS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'other';

/**
 * Which browser, on which platform, the reader is using — enough to pick the
 * steps that lift a notification block there. Pure: pass
 * `navigator.userAgent` and `navigator.maxTouchPoints`.
 */
export const detectNotificationBrowser = (
  userAgent: string,
  maxTouchPoints = 0,
): NotificationBrowser => ({
  family: familyOf(userAgent),
  platform: platformOf(userAgent, maxTouchPoints),
});

/**
 * The steps that lift a notification block in `browser`, from a
 * `NotificationUnblockCopy` pack (`PT_BR_NOTIFICATION_UNBLOCK_COPY`, …).
 *
 * Every iOS browser shares one list — the switch is in the device's Settings,
 * whichever browser installed the app — and a family or platform the pack does
 * not name falls back to its general `other` steps.
 */
export const notificationUnblockSteps = (
  copy: NotificationUnblockCopy,
  browser: NotificationBrowser,
): readonly string[] => {
  if (browser.platform === 'ios') return copy.ios;
  if (browser.family === 'other') return copy.other;
  const byPlatform: Partial<Record<NotificationPlatform, readonly string[]>> = copy[browser.family];
  return byPlatform[browser.platform] ?? copy.other;
};
