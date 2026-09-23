import type { SxProps, Theme } from '@mui/material/styles/index.js';

/**
 * Where a reader stands with this browser's notifications.
 *
 * - `enabled` — they will be notified here.
 * - `disabled` — they are not, and this page CAN ask: one tap raises the
 *   browser's own permission prompt.
 * - `blocked` — they are not, and this page can NOT ask: the browser refused
 *   once and only the reader can undo that, in the browser's own settings.
 * - `unavailable` — they are not, and nothing will change it here: the browser
 *   has no web push, or the host cannot send it.
 */
export type NotificationStatus = 'enabled' | 'disabled' | 'blocked' | 'unavailable';

interface NotificationStatusNoticeCommon {
  /** The one sentence that states the reader's situation. */
  title: string;
  /** What that situation means for them — e.g. what they will miss. */
  description?: string;
  /** Test id of the root; parts derive from it (`-enable`, `-steps`, …). */
  dataTestId?: string;
  className?: string;
  sx?: SxProps<Theme>;
}

export interface EnabledNoticeProps extends NotificationStatusNoticeCommon {
  status: 'enabled';
}

export interface DisabledNoticeProps extends NotificationStatusNoticeCommon {
  status: 'disabled';
  /** The action's label, e.g. "Turn on notifications". */
  enableLabel: string;
  /**
   * Ask for the permission. Call the browser's `requestPermission` from HERE:
   * a browser only shows its prompt inside a user gesture.
   */
  onEnable: () => void;
  /** The request is in flight — the action shows a spinner and cannot be pressed twice. */
  pending?: boolean;
}

export interface BlockedNoticeProps extends NotificationStatusNoticeCommon {
  status: 'blocked';
  /** The disclosure's label, e.g. "Turn them back on". */
  stepsToggleLabel: string;
  /**
   * How to lift the block in THIS reader's browser, one step per entry, in
   * order. The host picks them — `detectNotificationBrowser` says which
   * browser it is looking at — because the words are the host's.
   */
  steps: readonly string[];
  /** Start with the steps showing. Defaults to collapsed. */
  defaultStepsOpen?: boolean;
}

export interface UnavailableNoticeProps extends NotificationStatusNoticeCommon {
  status: 'unavailable';
}

export type NotificationStatusNoticeProps =
  | EnabledNoticeProps
  | DisabledNoticeProps
  | BlockedNoticeProps
  | UnavailableNoticeProps;

/** The browser families whose permission settings differ enough to need their own steps. */
export type NotificationBrowserFamily =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'safari'
  | 'samsung'
  | 'opera'
  | 'other';

export type NotificationPlatform = 'ios' | 'android' | 'desktop';

export interface NotificationBrowser {
  family: NotificationBrowserFamily;
  platform: NotificationPlatform;
}
