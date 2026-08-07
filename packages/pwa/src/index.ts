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
export { defaultMessages, resolveMessages, type PwaMessages } from "./messages";
