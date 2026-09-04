import type { PwaMessages } from "./messages";

/**
 * The en-US pack — the same prompts for an English-reading audience. The
 * filename is what exempts this file from the copy-portability gate, exactly as
 * `pt-BR.ts` beside it is exempt: a language may ship, it may not be silent.
 *
 * `what` is the host's own name for itself and is interpolated, never
 * translated — an app called "Palandira" is called that in every language.
 */
export const EN_US_PWA_MESSAGES: PwaMessages = {
  promptHandheld: (what) => `Install ${what} on your phone to order faster next time.`,
  promptDesktop: (what) => `Install ${what} on this computer to order faster next time.`,
  promptAccept: "Install app",

  // Benefit first, and on iOS literally true rather than marketing: web push
  // does not exist outside an installed app, so "get told when it is ready" is
  // unavailable until they do this.
  iosBenefit: (what) => `Get a heads-up when your order is ready — install ${what}.`,
  iosHow: "Tap",
  iosWhere: "in the browser bar, then “Add to Home Screen”.",

  dismiss: "Not now",
};

export { EN_US_PULL_TO_REFRESH_MESSAGES } from "./pull-to-refresh.en-US";
