/**
 * The en-US pack for the feedback family. Split the same way
 * `pt-BR.feedback.ts` is — see `en-US.ts` for why.
 */
import type {
  ChromeCopy,
  NotificationUnblockCopy,
  TutorialCopy,
} from './copy';

export const EN_US_TUTORIAL_COPY: TutorialCopy = {
  skip: "Skip",
  previous: "Back",
  next: "Next",
  restart: "Start over",
};

export const EN_US_CHROME_COPY: ChromeCopy = {
  dismissToast: "Dismiss",
  goBack: "Back",
  closePanel: "Close",
  closeTab: "Close tab",
  scrollRegion: "Scrollable content",
  scrollToTop: "Back to top",
  share: "Share",
};

const EN_US_CHROMIUM_DESKTOP = [
  "Click the icon to the left of the site's address.",
  "Open \"Site settings\".",
  "Under \"Notifications\", choose \"Allow\".",
  "Come back to this page and reload it.",
] as const;

const EN_US_CHROMIUM_ANDROID = [
  "Tap the icon to the left of the site's address.",
  "Tap \"Permissions\".",
  "Tap \"Notifications\" and choose \"Allow\".",
  "Come back to this page and reload it.",
] as const;

export const EN_US_NOTIFICATION_UNBLOCK_COPY: NotificationUnblockCopy = {
  ios: [
    "Open the iPhone's Settings.",
    "Tap \"Notifications\".",
    "Find this app in the list and turn on \"Allow Notifications\".",
  ],
  chrome: { desktop: EN_US_CHROMIUM_DESKTOP, android: EN_US_CHROMIUM_ANDROID },
  edge: {
    desktop: [
      "Click the lock to the left of the site's address.",
      "Open \"Permissions for this site\".",
      "Under \"Notifications\", choose \"Allow\".",
      "Come back to this page and reload it.",
    ],
    android: EN_US_CHROMIUM_ANDROID,
  },
  firefox: {
    desktop: [
      "Click the permissions icon to the left of the site's address.",
      "Next to \"Send notifications\", click the X to clear the block.",
      "Reload the page and turn notifications on again.",
    ],
    android: [
      "Open the browser menu and tap \"Settings\".",
      "Tap \"Site permissions\", then \"Notifications\".",
      "Find this site and choose \"Allow\".",
      "Come back to this page and reload it.",
    ],
  },
  opera: { desktop: EN_US_CHROMIUM_DESKTOP, android: EN_US_CHROMIUM_ANDROID },
  safari: {
    desktop: [
      "In the Safari menu, open \"Settings\".",
      "Go to the \"Websites\" tab and pick \"Notifications\" in the sidebar.",
      "Find this site and choose \"Allow\".",
      "Come back to this page and reload it.",
    ],
  },
  samsung: {
    android: [
      "Open the browser menu and tap \"Settings\".",
      "Tap \"Sites and downloads\", then \"Notifications\".",
      "Find this site and allow notifications.",
      "Come back to this page and reload it.",
    ],
  },
  other: [
    "Open the browser's settings.",
    "Look for site permissions, then \"Notifications\".",
    "Allow notifications for this site.",
    "Come back to this page and reload it.",
  ],
};
