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
export { type PwaMessages } from "./messages";
export { PT_BR_PWA_MESSAGES } from "./pt-BR";
export { EN_US_PWA_MESSAGES } from "./en-US";
export { PWA_MESSAGES } from "./locales";
// Boot registration (12-23): a registered worker is a PRECONDITION for
// installability, so it belongs on every visit rather than behind a settings
// screen. Browser-side but React-free, hence the root rather than `./react`.
export {
  postToServiceWorker,
  registerServiceWorker,
  type RegisterServiceWorkerOptions,
} from "./register";
