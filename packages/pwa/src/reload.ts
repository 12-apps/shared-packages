/**
 * Reloading an app that has no address bar (12-61).
 *
 * A browser tab always has a way back to a fresh document — the reload button,
 * the URL bar, and on every mobile browser a pull-to-refresh gesture. An
 * INSTALLED app has none of that chrome, and the whole feature set here exists
 * to make it look like a real app, so the chrome is not coming back.
 *
 * That leaves the person holding the phone with no move when the app is wedged:
 * a shell from a previous deploy, an expired session the page never noticed, a
 * screen that failed its one fetch. `@12-apps/pwa`'s own adoption contract
 * states the consequence plainly — *"on an INSTALLED app 'force-refresh' is
 * advice the user cannot follow"* — and until now the package fixed only the
 * half it could fix without the user (the network-first worker). This is the
 * other half: give the reload back, as something they can reach.
 *
 * ## The two platforms differ, again, and only one needs us
 *
 * - **Chromium on Android keeps its overscroll refresh in standalone mode.** An
 *   installed PWA there still reloads when the user pulls down at the top of
 *   the page, exactly as a tab does, unless the app itself opted out with
 *   `overscroll-behavior-y: contain | none`. Nothing is missing, and a second
 *   gesture layered on top of a working one is how you get a double reload.
 * - **iOS home-screen web apps have no reload at all.** No chrome, and the pull
 *   gesture that works in Safari does not reload a standalone web app. The
 *   documented workaround in the wild is to delete the icon and add it again.
 *
 * So {@link needsPullToRefresh} is true on exactly one combination — installed,
 * on iOS — and `@12-apps/pwa/react`'s `PullToRefresh` is inert everywhere else.
 * That is the same shape as the install invite: two platforms that share
 * nothing, and a package that says so instead of averaging them.
 */
import { isIosInstallable, isStandalone } from "./install-prompt";

/**
 * Whether this session has no reload the user can reach on their own.
 *
 * `isIosInstallable()` is reused rather than re-spelled: despite the name it is
 * a plain "is this iOS" user-agent test (iPhone/iPad/iPod, plus the iPad that
 * reports itself as a Mac with a touchscreen), and one spelling of that test
 * cannot drift from the other.
 *
 * Deliberately NOT `isHandheld()`. The question is whether the PLATFORM took
 * the reload away, and it is the display mode plus the engine that decide that,
 * not the pointer. A desktop installed app has no address bar either, but it
 * has Ctrl+R and a context menu, so it is not this function's problem.
 */
export function needsPullToRefresh(): boolean {
  return isStandalone() && isIosInstallable();
}

export interface ReloadAppOptions {
  /**
   * How long to wait for the service-worker update check before reloading
   * anyway. Default 2000ms.
   *
   * A bound rather than a plain `await`, because the check is a network request
   * and the person who just pulled down is usually the person whose network is
   * having a bad day. Reloading a beat later against the worker we already have
   * is a perfectly good outcome; a spinner that never ends is not.
   */
  timeoutMs?: number;
}

/** Resolves when `promise` settles, or after `ms`, whichever comes first. */
function within(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(resolve, ms);
    promise.then(done, done);
  });
}

/**
 * Reload the app, picking up a new deploy if there is one.
 *
 * `location.reload()` on its own is *almost* enough, and the gap is worth
 * stating because it is the case this exists for. The open document is
 * controlled by whichever worker was active when it loaded; the browser's own
 * update check races the navigation rather than preceding it, so a reload
 * issued the moment a deploy lands can still be served by the outgoing worker
 * and hand back the very shell the user was trying to escape. Asking for the
 * update FIRST and waiting for it closes that window: the packaged worker (and
 * every host worker following rule 6) calls `skipWaiting()` at the end of
 * `install` and `clients.claim()` in `activate`, so by the time `update()`
 * settles the new worker is the one that will answer the navigation.
 *
 * Everything here fails towards reloading. No worker, no support, a rejected
 * update, a network that never answers — each of them lands on
 * `location.reload()` just the same, because a reload the user asked for must
 * never be something the app declines to do.
 */
export async function reloadApp(options: ReloadAppOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const update = navigator.serviceWorker
      .getRegistration()
      .then((registration) => registration?.update())
      .catch(() => undefined);
    await within(update, timeoutMs);
  }
  window.location.reload();
}
