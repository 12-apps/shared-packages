import type { InstallPlatform } from './InstallPrompt.types';

/**
 * Pure environment probes and dismissal storage for `usePwaInstall`.
 *
 * Everything here is a plain function taking its clock and its storage from the
 * caller where that matters, so the hook's behaviour is testable without
 * faking timers or a browser.
 */

export const DEFAULT_STORAGE_KEY = 'pwa-install-dismissed';
export const DEFAULT_DISMISS_DAYS = 30;

const MS_PER_DAY = 86_400_000;
const STANDALONE_QUERY = '(display-mode: standalone)';

/** iOS Safari predates `display-mode` and exposes this instead. */
interface IosNavigator extends Navigator {
  standalone?: boolean;
}

/** Guard for SSR and for jsdom runs where `matchMedia` is not implemented. */
const hasWindow = (): boolean => typeof window !== 'undefined';

/**
 * True when the page is already running as an installed app.
 *
 * Both checks are needed: `display-mode: standalone` is the standard signal,
 * but iOS never implemented it for home-screen launches and reports
 * `navigator.standalone` instead. Miss the iOS branch and the installed app
 * nags its own users to install it again.
 */
export const isStandaloneDisplay = (): boolean => {
  if (!hasWindow()) return false;
  if ((window.navigator as IosNavigator).standalone === true) return true;
  return window.matchMedia?.(STANDALONE_QUERY).matches === true;
};

/**
 * True for Safari on iOS/iPadOS — the one browser that can install but cannot
 * be asked programmatically.
 *
 * Two traps handled here. iPadOS 13+ reports a Macintosh user agent, so the
 * touch-point count is what separates an iPad from a desktop; and Chrome,
 * Firefox and Edge on iOS are Safari underneath but offer no Add to Home
 * Screen at all, so telling their users to tap Share is a dead end.
 *
 * Kept parameterised so the agent table can be tested without reassigning
 * `navigator`, which leaks across test files when it is not restored.
 */
export const isIosSafariAgent = (userAgent: string, maxTouchPoints: number): boolean => {
  const isIosDevice =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (userAgent.includes('Macintosh') && maxTouchPoints > 1);

  if (!isIosDevice) return false;

  return !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
};

/** `isIosSafariAgent` against the live browser. Internal — callers use `resolveInstallPlatform`. */
const isIosSafari = (): boolean => {
  if (!hasWindow()) return false;

  const { userAgent, maxTouchPoints } = window.navigator;
  return isIosSafariAgent(userAgent, maxTouchPoints);
};

/**
 * Reads the stored dismissal timestamp.
 *
 * Storage access is wrapped because it THROWS rather than returning null in
 * Safari private mode and wherever cookies are blocked — an uncaught throw
 * here would take down the storefront on the very browsers this component
 * exists to serve.
 */
export const readDismissedAt = (storageKey: string): number | null => {
  if (!hasWindow()) return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Persists a dismissal. Silently a no-op when storage is unavailable. */
export const writeDismissedAt = (storageKey: string, at: number): void => {
  if (!hasWindow()) return;

  try {
    window.localStorage.setItem(storageKey, String(at));
  } catch {
    // Storage blocked — the dismissal lasts for this page view only.
  }
};

/**
 * Whether a stored dismissal still suppresses the prompt.
 *
 * `dismissForDays: 0` means forever. A timestamp in the future (a device whose
 * clock was wound back) is treated as active rather than expired, so a bad
 * clock cannot turn into a prompt on every page view.
 */
export const isDismissalActive = (
  dismissedAt: number | null,
  dismissForDays: number,
  now: number,
): boolean => {
  if (dismissedAt === null) return false;
  if (dismissForDays <= 0) return true;

  return now - dismissedAt < dismissForDays * MS_PER_DAY;
};

/** Resolves which install route this browser offers. */
export const resolveInstallPlatform = (hasDeferredPrompt: boolean): InstallPlatform => {
  if (hasDeferredPrompt) return 'prompt';
  return isIosSafari() ? 'ios' : 'unsupported';
};
