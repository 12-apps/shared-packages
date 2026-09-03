/**
 * `@12-apps/pwa` — making a web app installable, and telling people it is.
 *
 * The framework-free half: platform detection and the `beforeinstallprompt`
 * state machine. The invite itself lives in `@12-apps/pwa/react`, so a host
 * that only needs to know "can this be installed" does not pull React in
 * through a barrel it did not ask for.
 */
export {
  isHandheld,
  isIosInstallable,
  isStandalone,
  useInstallPrompt,
  type BeforeInstallPromptEvent,
  type EarlyInstallStash,
  type InstallOffer,
  type InstallPromptState,
  type UseInstallPromptOptions,
} from "./install-prompt";
export { type PullToRefreshMessages, type PwaMessages } from "./messages";
export { PT_BR_PULL_TO_REFRESH_MESSAGES, PT_BR_PWA_MESSAGES } from "./pt-BR";
export { EN_US_PULL_TO_REFRESH_MESSAGES, EN_US_PWA_MESSAGES } from "./en-US";
export { PULL_TO_REFRESH_MESSAGES, PWA_MESSAGES } from "./locales";
// Boot registration (12-23): a registered worker is a PRECONDITION for
// installability, so it belongs on every visit rather than behind a settings
// screen. Browser-side but React-free, hence the root rather than `./react`.
export {
  postToServiceWorker,
  registerServiceWorker,
  type RegisterServiceWorkerOptions,
} from "./register";
// Reloading an app with no address bar (12-61). Browser-side, React-free, and
// the gesture's own arithmetic — so a host can ask "does this session even have
// a reload?" without mounting anything.
export { needsPullToRefresh, reloadApp, type ReloadAppOptions } from "./reload";
export {
  createPullTracker,
  DEFAULT_PULL_GEOMETRY,
  documentAtTop,
  pullBlockedBy,
  PULL_REFRESH_OPT_OUT_ATTR,
  resistPull,
  type PullGeometry,
  type PullPhase,
  type PullPoint,
  type PullTracker,
  type PullUpdate,
} from "./pull-gesture";
