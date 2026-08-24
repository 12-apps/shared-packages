import type { EmailAuthSettingsCopy } from "./copy";

/**
 * The platform sign-in console, in US English.
 *
 * Passed by name (`copy: EN_US_SETTINGS`), never applied by default.
 *
 * The two switch descriptions are the screen's entire reason to exist, and the
 * translation keeps what makes them worth having: they say what the switch
 * COSTS, not what it does. The verification one in particular is the sentence
 * nobody writes unprompted — ON is not merely "safer", it also makes sign-up
 * non-enumerating, and turning it off buys a shorter funnel by giving that
 * property away. An English rewrite that said "requires e-mail confirmation"
 * and stopped would lose the only part an operator needs.
 */
export const EN_US_SETTINGS: EmailAuthSettingsCopy = {
  title: "Sign-in",
  intro:
    // "the whole platform", not "every store": these switches are platform-
    // wide, and a package's own pack must not assume its host sells anything.
    "How people sign in to the platform. Both options apply across the whole " +
    "platform and take effect on the next request — there is nothing to publish.",

  methodLabel: "Sign in with e-mail and password",
  methodDescription:
    "Lets people create an account and sign in with an e-mail and password, " +
    "alongside the social providers. Switching it off refuses the method for " +
    "everyone, including those who already have a password — nothing is " +
    "deleted, and switching it back on returns those accounts as they were.",

  verificationLabel: "Require e-mail confirmation",
  verificationDescription:
    "On: the account only works after the emailed link is clicked — and sign-up " +
    "stops revealing whether an address already has an account, because the " +
    "answer becomes the same either way. Off: the account works immediately, " +
    "and in exchange sign-up can now say that an address is already in use.",

  verificationInertNote:
    "E-mail confirmation only has an effect while sign-in with e-mail and password is on.",

  saveFailedTitle: "Could not save",
  saveFailedDescription: "The change was not applied. Try again.",
  saveFailedDismiss: "Dismiss",

  loadFailedTitle: "Could not load the sign-in settings",
  retry: "Try again",

  lastChanged: (when, who) => `Last changed ${when}${who ? ` by ${who}` : ""}.`,
};
