/**
 * The feedback family's words — the tutorial overlay and the app chrome it
 * points at.
 *
 * Split out of `copy.ts`, which is a barrel over this folder: one file
 * listing every family is the file that grows on every port, and it stopped
 * fitting the 400-line budget the rest of this package holds itself to.
 */

/**
 * The states a data surface can be in with nothing to draw, and the dismiss
 * every banner-like surface carries.
 *
 * One object rather than six, because these are the same four sentences the
 * table, the grid, the async container, the hover card and the infinite
 * scroller each rendered their own copy of.
 */
/** The guided tour's four controls, and the toast/modal chrome around it. */
export interface TutorialCopy {
  skip: string;
  previous: string;
  next: string;
  restart: string;
}

/** Chrome that carries a glyph and no text, across several small surfaces. */
export interface ChromeCopy {
  /** The toast's dismiss, and the stacked modal's step-back arrow. */
  dismissToast: string;
  goBack: string;
  /** A dashboard panel's close, and a tab's. */
  closePanel: string;
  closeTab: string;
  /** The scroll region itself, and the button that returns to its top. */
  scrollRegion: string;
  scrollToTop: string;
  /** The share affordance in the install prompt. */
  share: string;
}

/** One ordered list of steps a reader follows in their browser. */
type Steps = readonly string[];

/**
 * How to lift a notification block, per browser — the steps
 * `NotificationStatusNotice` shows in its `blocked` state.
 *
 * Keyed the way `detectNotificationBrowser` answers, and read through
 * `notificationUnblockSteps`, which falls back to `other` for anything a pack
 * does not name. Menu labels move between browser versions; these follow the
 * current ones and say where to look rather than promising an exact word.
 */
export interface NotificationUnblockCopy {
  /**
   * Every browser on iOS. Web push there belongs to a Home Screen app, so the
   * switch lives in the device's Settings rather than in any browser.
   */
  ios: Steps;
  chrome: { desktop: Steps; android: Steps };
  edge: { desktop: Steps; android: Steps };
  firefox: { desktop: Steps; android: Steps };
  opera: { desktop: Steps; android: Steps };
  safari: { desktop: Steps };
  samsung: { android: Steps };
  /** Anything unrecognised — general enough to be true everywhere. */
  other: Steps;
}
