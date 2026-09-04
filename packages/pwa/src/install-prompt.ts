/**
 * "This app can be installed" — the state behind an install invite.
 *
 * Split from the component because the interesting part is not the button, it
 * is WHEN there is anything to offer, and that is four questions with four
 * different answers per platform:
 *
 *   - Chromium fires `beforeinstallprompt`, which must be captured and HELD. It
 *     arrives once, early, and cannot be re-requested — a listener added after
 *     it fires misses the only chance the page gets. It fires on DESKTOP as
 *     readily as on Android, which is why the copy is chosen by input device
 *     and not assumed to be a phone.
 *   - iOS has NO API at all. Installation is Share → Add to Home Screen, by
 *     hand, so the only thing on offer is an instruction — in EVERY iOS
 *     browser, not only Safari: iOS 16.4 opened the share-sheet item to any
 *     browser holding the `com.apple.developer.web-browser` entitlement.
 *   - An ALREADY-INSTALLED app must offer nothing. `display-mode: standalone`
 *     is the reliable signal and covers both platforms.
 *   - A dismissal must stick for the session. Somebody who said no does not
 *     want to be asked again on the next page.
 *
 * The prompt is NEVER opened automatically. A browser lets a page ask once, and
 * asking on a first visit — before the visitor knows what the app even is —
 * spends that one chance on a near-certain "no", which the browser then
 * remembers for a very long time.
 */
import { useCallback, useEffect, useRef, useState } from "react";

// Re-exported, not redefined: they moved to a React-free module so that
// asking "is this installed" cannot pull this file — and the invite that
// shares its module graph — onto a host's critical path. See ./platform.
import { isHandheld, isIosInstallable, isStandalone } from "./platform";

export { isHandheld, isIosInstallable, isStandalone };

/** The non-standard event Chromium fires when the app is installable. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * A pre-React capture the host may install from an inline script in its HTML.
 *
 * It exists because this hook usually CANNOT be early enough: if the invite
 * first mounts on a confirmation screen, `beforeinstallprompt` fired pages ago.
 * The stash is the only bridge. Absent is fine — the listeners below still
 * catch a browser that re-evaluates installability later.
 */
export interface EarlyInstallStash {
  event: BeforeInstallPromptEvent | null;
  firedAt: number | null;
  installedAt: number | null;
}

function earlyStash(): EarlyInstallStash | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { __pwaInstall?: EarlyInstallStash }).__pwaInstall ?? null;
}

/** sessionStorage key holding a dismissal. Per-tab, per-session, by design. */
const DISMISSED_KEY = "pwa:install-dismissed";

/** What, if anything, this browser can be offered. */
export type InstallOffer =
  /** Chromium held a prompt for us — a real one-tap install. */
  | "prompt"
  /** Any iOS browser: no API, so all we have is the manual instruction. */
  | "ios-instructions"
  /** Nothing to offer: already installed, unsupported, or dismissed. */
  | "none";

export interface InstallPromptState {
  offer: InstallOffer;
  /** Opens the browser's own installer. Only meaningful for `"prompt"`. */
  install: () => Promise<void>;
  /** Hides the invite for the rest of this session. */
  dismiss: () => void;
}


function wasDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    // Storage blocked (private mode, cookie policy). Fail towards NOT nagging:
    // an invite that cannot remember a refusal would reappear on every page.
    return true;
  }
}

function rememberDismissal(): void {
  try {
    window.sessionStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Ignore — `wasDismissed` already fails closed when storage is unavailable.
  }
}

export interface UseInstallPromptOptions {
  /**
   * The host's own gate. An app that is only installable on certain origins
   * passes `false` elsewhere, which keeps the hook inert without the caller
   * having to break the rules of hooks.
   */
  enabled: boolean;
  /**
   * Told, once per mount, WHY the invite declined to appear.
   *
   * This failure is silent by nature: nothing throws, so a broken invite looks
   * exactly like a healthy page. Wire it to whatever the host reports with —
   * `reportWarning` from `@12-apps/observability-frontend`, for instance.
   */
  onDiagnostic?: (message: string, context: Record<string, unknown>) => void;
}

/** Track installability for the current browser. */
export function useInstallPrompt({
  enabled,
  onDiagnostic,
}: UseInstallPromptOptions): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    setDismissed(wasDismissed());
    setInstalled(isStandalone());

    // The stash is the PRIMARY source, not a fallback. By the time this hook
    // mounts the event has usually already fired and been held for us; the
    // listeners below only cover a browser that re-evaluates installability
    // later, while the app is still running.
    const stash = earlyStash();
    if (stash?.event) setDeferred(stash.event);
    if (stash?.installedAt != null) setInstalled(true);

    const adopt = (): void => {
      const held = earlyStash()?.event ?? null;
      if (held) setDeferred(held);
    };
    const onBeforeInstall = (event: Event): void => {
      // Suppressing the default is what makes the browser hand us the event to
      // fire later, instead of showing its own mini-infobar immediately.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("pwa-install-available", adopt);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("pwa-install-available", adopt);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [enabled]);

  const install = useCallback(async (): Promise<void> => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    // Spent either way: the event cannot be reused, so holding it would leave a
    // button that silently does nothing. A refusal here is also a refusal for
    // the session — re-offering after "no" is the definition of nagging.
    setDeferred(null);
    if (choice.outcome === "dismissed") {
      rememberDismissal();
      setDismissed(true);
    }
  }, [deferred]);

  const dismiss = useCallback((): void => {
    rememberDismissal();
    setDismissed(true);
  }, []);

  const offer = offerFor({ enabled, installed, dismissed, deferred });
  useNoOfferDiagnostics({ enabled, offer, installed, dismissed, deferred, onDiagnostic });

  return { offer, install, dismiss };
}

/**
 * Say WHY the invite declined to appear — once per mount, and only when it did.
 *
 * Read the payload as a decision table:
 *
 *   earlyScriptPresent false -> document older than the inline capture; deploy
 *   earlyEventHeld     false -> the browser never judged the page installable
 *   earlyEventFiredAt set but hasDeferred false -> the stash is not adopted
 *   installed / dismissed true -> working as designed, not a fault
 */
function useNoOfferDiagnostics({
  enabled,
  offer,
  installed,
  dismissed,
  deferred,
  onDiagnostic,
}: {
  enabled: boolean;
  offer: InstallOffer;
  installed: boolean;
  dismissed: boolean;
  deferred: BeforeInstallPromptEvent | null;
  onDiagnostic?: (message: string, context: Record<string, unknown>) => void;
}): void {
  const reported = useRef(false);

  useEffect(() => {
    if (!enabled || offer !== "none" || reported.current || !onDiagnostic) return;
    reported.current = true;

    const stash = earlyStash();
    onDiagnostic("install-invite: nothing to offer", {
      installed,
      dismissed,
      hasDeferred: deferred !== null,
      earlyScriptPresent: stash !== null,
      earlyEventHeld: stash?.event != null,
      earlyEventFiredAt: stash?.firedAt ?? null,
      iosInstallable: isIosInstallable(),
      standalone: isStandalone(),
    });
  }, [enabled, offer, installed, dismissed, deferred, onDiagnostic]);
}

function offerFor({
  enabled,
  installed,
  dismissed,
  deferred,
}: {
  enabled: boolean;
  installed: boolean;
  dismissed: boolean;
  deferred: BeforeInstallPromptEvent | null;
}): InstallOffer {
  // Order matters. "Already installed" outranks everything — somebody looking
  // at the app does not need to be invited into it.
  if (!enabled || installed || dismissed) return "none";
  if (deferred) return "prompt";
  return isIosInstallable() ? "ios-instructions" : "none";
}
