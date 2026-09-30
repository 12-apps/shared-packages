/**
 * `@12-apps/desktop-shell/updates` — an agent that replaces itself.
 *
 * Framework-free: `electron-updater` is the HOST's dependency, handed in as
 * {@link UpdaterPort} (its `autoUpdater` fits as it is), so every rule here is
 * a plain Node test. What is here:
 *
 * - {@link createUpdateManager} — checks on a daily floor plus whenever the
 *   host asks, downloads in the background, and folds the updater's events
 *   into one {@link UpdateState}. The feed URL and the switch are read from
 *   the host per check; a gated feed gets the session as a header.
 * - {@link createAutoInstall} — restarts into a ready version by itself,
 *   never in the middle of work, never twice into an installer that failed.
 * - {@link updateBanner} — which sentence and which button the window's strip
 *   shows. The words are the host's.
 * - {@link createMenuGate} and {@link sameMenu} — redrawing an application
 *   menu without replacing it under an open popup.
 * - {@link buildAppMenu} and {@link updateText} — the menu bar itself, with
 *   the updater under Help and the host's own entries first under File. The
 *   Electron half is `installAppMenu` and `wireUpdates` in `./electron`.
 */
export {
  CHECK_EVERY_MS,
  createUpdateManager,
  progressed,
  updatesSupported,
  type SessionCookiePort,
  type UpdateManager,
  type UpdateManagerOptions,
  type UpdaterPort,
  type UpdateSettings,
  type UpdateState,
} from "./manager";
export { createAutoInstall, INSTALL_GRACE_MS, INSTALL_RETRY_MS } from "./auto-install";
export { updateBanner, type UpdateBanner, type UpdateBannerCopy } from "./update-banner";
export { createMenuGate, menuUpdateState, sameMenu, type MenuGate } from "./menu";
export {
  buildAppMenu,
  updateText,
  type AppMenuActions,
  type AppMenuInput,
  type AppMenuItem,
  type MenuCopy,
  type UpdateCopy,
} from "./app-menu";
