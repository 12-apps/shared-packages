import { useCallback, useEffect, useRef, useState } from 'react';

import { PWA_INSTALL_AVAILABLE_EVENT, readPwaInstallStash } from './InstallPrompt.earlyCapture';
import {
  DEFAULT_DISMISS_DAYS,
  DEFAULT_STORAGE_KEY,
  isDismissalActive,
  isStandaloneDisplay,
  readDismissedAt,
  resolveInstallPlatform,
  writeDismissedAt,
} from './InstallPrompt.helpers';
import type {
  BeforeInstallPromptEvent,
  InstallOutcome,
  InstallPlatform,
  PwaInstallState,
  UsePwaInstallOptions,
} from './InstallPrompt.types';

/**
 * Headless PWA install machinery.
 *
 * A manifest and a service worker make a site installABLE; they do not make it
 * install. Chromium announces its willingness by firing `beforeinstallprompt`
 * and then does nothing further on its own beyond a small address-bar icon most
 * users never notice. Unless a page calls `preventDefault()` on that event and
 * keeps it, the handle is gone and the app can never ask.
 *
 * That is the whole reason this hook exists. It captures the event, tracks the
 * three states that should suppress an install invitation (already installed,
 * recently dismissed, browser cannot install), and hands back a
 * gesture-callable `promptInstall`.
 *
 * Every environment probe runs in an effect rather than in a state initialiser:
 * touching `window` during render breaks SSR and desynchronises hydration, so
 * the first paint deliberately reports `canInstall: false` and corrects itself
 * on mount.
 */

/** Tracks whether the page is running as an installed app. */
const useInstalledState = (onInstalled?: () => void) => {
  const [isInstalled, setIsInstalled] = useState(false);

  // Held in a ref, and refreshed in its own effect rather than during render, so
  // that a caller passing an inline callback does not re-subscribe the listener
  // on every render.
  const onInstalledRef = useRef(onInstalled);
  useEffect(() => {
    onInstalledRef.current = onInstalled;
  }, [onInstalled]);

  useEffect(() => {
    // `appinstalled` can also land before the app mounts, so the stash is
    // consulted for the same reason the deferred event is.
    setIsInstalled(isStandaloneDisplay() || readPwaInstallStash()?.installedAt != null);

    const markInstalled = () => {
      setIsInstalled(true);
      onInstalledRef.current?.();
    };

    window.addEventListener('appinstalled', markInstalled);
    return () => window.removeEventListener('appinstalled', markInstalled);
  }, []);

  return isInstalled;
};

/**
 * Holds the deferred `beforeinstallprompt` event.
 *
 * The stash written by `capturePwaInstallEvent` is the PRIMARY source, not a
 * fallback. Chromium fires the event once, during initial page load; a
 * listener attached in an effect runs after hydration and, when the component
 * is code-split, after a download that may not happen until a later route. In
 * a real browser it essentially never catches the event, and the event is not
 * reissued on request — so a hook that relies on its own listener reports
 * "cannot install" forever on the one platform that can.
 *
 * The live listeners below therefore cover only the narrow case they can
 * actually serve: a browser re-evaluating installability while the app is
 * already running, and a host that never wired the capture at all.
 */
const useDeferredPrompt = () => {
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);
  const [promptReady, setPromptReady] = useState(false);

  useEffect(() => {
    const hold = (event: BeforeInstallPromptEvent) => {
      deferredRef.current = event;
      setPromptReady(true);
    };

    // Whatever fired before this component existed.
    const held = readPwaInstallStash()?.event;
    if (held) hold(held);

    // The capture rang the bell after mount: adopt what it is holding.
    const adopt = () => {
      const fresh = readPwaInstallStash()?.event;
      if (fresh) hold(fresh);
    };

    const capture = (event: Event) => {
      // Without preventDefault the browser owns the event and the handle dies
      // with it. The capture has normally done this already; repeating it is
      // harmless and keeps the hook correct on a host that skipped wiring.
      event.preventDefault();
      hold(event as BeforeInstallPromptEvent);
    };

    window.addEventListener(PWA_INSTALL_AVAILABLE_EVENT, adopt);
    window.addEventListener('beforeinstallprompt', capture);
    return () => {
      window.removeEventListener(PWA_INSTALL_AVAILABLE_EVENT, adopt);
      window.removeEventListener('beforeinstallprompt', capture);
    };
  }, []);

  const clearPrompt = useCallback(() => {
    deferredRef.current = null;
    setPromptReady(false);
  }, []);

  return { deferredRef, promptReady, clearPrompt };
};

/** Reads and writes the "don't ask again for a while" record. */
const useDismissal = (storageKey: string, dismissForDays: number) => {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const dismissedAt = readDismissedAt(storageKey);
    setDismissed(isDismissalActive(dismissedAt, dismissForDays, Date.now()));
  }, [storageKey, dismissForDays]);

  const persistDismissal = useCallback(() => {
    writeDismissedAt(storageKey, Date.now());
    setDismissed(true);
  }, [storageKey]);

  return { dismissed, persistDismissal };
};

/** Resolves the install route once the deferred-prompt state is known. */
const useInstallPlatform = (promptReady: boolean): InstallPlatform => {
  const [platform, setPlatform] = useState<InstallPlatform>('unsupported');

  useEffect(() => {
    setPlatform(resolveInstallPlatform(promptReady));
  }, [promptReady]);

  return platform;
};

export const usePwaInstall = (options: UsePwaInstallOptions = {}): PwaInstallState => {
  const {
    storageKey = DEFAULT_STORAGE_KEY,
    dismissForDays = DEFAULT_DISMISS_DAYS,
    onInstalled,
  } = options;

  const isInstalled = useInstalledState(onInstalled);
  const { deferredRef, promptReady, clearPrompt } = useDeferredPrompt();
  const { dismissed, persistDismissal } = useDismissal(storageKey, dismissForDays);
  const platform = useInstallPlatform(promptReady);

  const promptInstall = useCallback(async (): Promise<InstallOutcome> => {
    const deferred = deferredRef.current;
    if (!deferred) return 'unavailable';

    await deferred.prompt();
    const { outcome } = await deferred.userChoice;

    // Single-use handle: spent whichever way the user answered. Chromium emits a
    // fresh event if the app is still installable, so holding this one would
    // only mean calling prompt() twice on a dead event.
    clearPrompt();

    // Declining the browser's own dialog is a real "no" — record it, or the
    // affordance reappears on the next render and badgers the user.
    if (outcome === 'dismissed') persistDismissal();

    return outcome;
  }, [deferredRef, clearPrompt, persistDismissal]);

  // iOS has no event to wait for, so its affordance is gated on the platform
  // probe alone; everywhere else a live captured prompt is the prerequisite.
  const canInstall = !isInstalled && !dismissed && (platform === 'ios' || promptReady);

  return {
    canInstall,
    platform,
    isInstalled,
    promptInstall,
    dismiss: persistDismissal,
  };
};
