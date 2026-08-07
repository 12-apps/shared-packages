import type { BeforeInstallPromptEvent, PwaInstallStash } from './InstallPrompt.types';

/**
 * Holds `beforeinstallprompt` from before the app exists.
 *
 * `usePwaInstall` cannot attach its own listener early enough, and no React
 * hook can. Chromium fires the event once, during initial page load, the
 * moment it has a manifest and a registered worker — which in a real app is
 * before hydration, and often before the chunk containing the component has
 * even been downloaded. A listener registered in an effect is not late by
 * milliseconds; it can be late by entire navigations. Nothing calls
 * `preventDefault()` in time, the browser keeps the event, and the page can
 * never ask again.
 *
 * So the capture has to live outside React, and the host has to install it as
 * the very first thing the document does. Two supported ways, in order of
 * reliability:
 *
 * 1. An inline `<script>` in `<head>`, which beats a deferred module bundle:
 *
 *        <script>
 *          window.addEventListener('beforeinstallprompt', function (e) {
 *            e.preventDefault();
 *            var s = (window.__pwaInstall = window.__pwaInstall || {});
 *            s.event = e; s.firedAt = Date.now();
 *            window.dispatchEvent(new Event('pwa-install-available'));
 *          });
 *        </script>
 *
 * 2. `capturePwaInstallEvent()` as the first statement of the entry module,
 *    before `createRoot`. Simpler to wire and correct in most apps, but a
 *    module is still deferred, so a very early event can outrun it.
 *
 * Both write the same shape, so the hook does not care which was used.
 */

/** Property on `window` holding the captured event. Shared with the inline snippet. */
export const PWA_INSTALL_STASH_KEY = '__pwaInstall';

/** Fired after a capture, so an app already running can adopt the event. */
export const PWA_INSTALL_AVAILABLE_EVENT = 'pwa-install-available';

type StashHost = Window & { [PWA_INSTALL_STASH_KEY]?: PwaInstallStash };

/** The stash, or `null` when no capture ever ran (SSR, or a host that skipped wiring). */
export const readPwaInstallStash = (): PwaInstallStash | null => {
  if (typeof window === 'undefined') return null;
  return (window as StashHost)[PWA_INSTALL_STASH_KEY] ?? null;
};

const ensureStash = (): PwaInstallStash => {
  const host = window as StashHost;
  host[PWA_INSTALL_STASH_KEY] ??= { event: null, firedAt: null, installedAt: null };
  return host[PWA_INSTALL_STASH_KEY];
};

/**
 * The teardown for the capture currently running, so `resetPwaInstallStash`
 * can unwind completely. Held here rather than on the stash because it must
 * survive the stash being deleted, and because it must never be serialised
 * into the diagnostic payload.
 */
let activeTeardown: (() => void) | null = null;

/**
 * Starts capturing. Returns a teardown, and is safe to call twice — a second
 * call is a no-op rather than a duplicate listener, so a host that wires both
 * the inline snippet and this function does not double-handle the event.
 */
export const capturePwaInstallEvent = (): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;

  const stash = ensureStash();
  if (stash.capturing === true) return () => undefined;
  stash.capturing = true;

  const onBeforeInstall = (event: Event): void => {
    // The line the whole component depends on. Without it the browser owns the
    // event, shows at most its own mini-infobar, and discards the handle.
    event.preventDefault();
    stash.event = event as BeforeInstallPromptEvent;
    stash.firedAt = Date.now();
    window.dispatchEvent(new Event(PWA_INSTALL_AVAILABLE_EVENT));
  };

  const onInstalled = (): void => {
    stash.installedAt = Date.now();
    stash.event = null;
  };

  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  window.addEventListener('appinstalled', onInstalled);

  const teardown = () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    window.removeEventListener('appinstalled', onInstalled);
    stash.capturing = false;
    if (activeTeardown === teardown) activeTeardown = null;
  };

  activeTeardown = teardown;
  return teardown;
};

/**
 * Returns the page to its pre-capture state: listeners removed, stash gone.
 *
 * Exists for tests and stories, which need a clean page per case. It unwinds
 * the listeners as well as the data, because a leaked capture from a previous
 * case would go on suppressing events that the next case expects to observe.
 */
export const resetPwaInstallStash = (): void => {
  if (typeof window === 'undefined') return;
  activeTeardown?.();
  activeTeardown = null;
  delete (window as StashHost)[PWA_INSTALL_STASH_KEY];
};
