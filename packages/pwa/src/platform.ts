/**
 * What KIND of session is this — installed or not, touch or not, iOS or not.
 *
 * Split out of `install-prompt.ts` (12-62) for one reason, and it is a
 * consumer's critical path rather than tidiness. These three predicates are the
 * cheapest thing in the package and the most widely wanted: `reload.ts` needs
 * them, and so does any host deciding whether to mount something. Left where
 * they were, importing one of them dragged in the whole `beforeinstallprompt`
 * state machine, `useInstallPrompt` and therefore React — and, through the
 * module graph a bundler then shares, the install invite itself.
 *
 * Measured in a host that mounts the reload gesture at its app root: the invite
 * moved out of a lazy chunk and into the ENTRY chunk, putting code that only
 * ever runs on a checkout confirmation screen in front of every shopper's first
 * paint. Nothing here imports React, so nothing here can do that again.
 *
 * `install-prompt.ts` re-exports all three, so every existing import keeps
 * working unchanged.
 */

/** Whether the page is being rendered as an installed app. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS predates the media query and exposes this instead. Non-standard, so it
  // is read defensively rather than typed onto Navigator.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * An iOS browser that can add this page to the home screen — which, since
 * iOS 16.4, is ALL of them and not Safari alone.
 *
 * Deliberately does not look at WHICH browser. Excluding `CriOS`/`FxiOS`/
 * `EdgiOS` was correct before March 2023 and has been a bug since: it told a
 * large share of iPhone users nothing at all, leaving them no way to discover
 * the app existed.
 *
 * Still an INSTRUCTION rather than a button, and not provisionally so. There is
 * no `beforeinstallprompt` in any Safari through 26.6 or 27 beta; MDN's compat
 * data records `safari: false` with `safari_ios` and `webview_ios` mirroring it
 * — and `webview_ios` is what every iOS browser is, Chrome included. WebKit's
 * standards position on the Web Install API (`navigator.install`) is `oppose`.
 * Design for the share sheet.
 */
export function isIosInstallable(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) || (/mac/i.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * A touch-primary device — phone or tablet.
 *
 * Decides COPY only, never behaviour. `beforeinstallprompt` fires on desktop
 * Chrome and Edge just as it does on Android, so the one-tap branch is reached
 * on a laptop, and telling that visitor to install "on your phone" describes a
 * device they are not holding.
 *
 * `(pointer: coarse)` rather than a user-agent test: the question is whether
 * this is a handheld, and the input device answers it directly instead of
 * inferring it from a string vendors keep rewriting.
 */
export function isHandheld(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}
