import type { AccessCopy } from "./copy";

/**
 * US English for the access surface — the second locale this ships with.
 */
export const EN_US_ACCESS: AccessCopy = {
  checkEmail: {
    title: "Check your e-mail",
    description: (email) => `We have sent a confirmation link to ${email}.`,
    resend: "Send the link again",
    changeEmail: "Use another e-mail address",
    resent: "Done — we have sent another link.",
    resending: "Sending…",
  },
  rateLimit: {
    // Singular and plural are the pack's job, not the formatter's: the rule
    // differs per language, and a package that guessed would be wrong in most.
    seconds: (count) => (count === 1 ? "1 second" : `${count} seconds`),
    minutes: (count) => (count === 1 ? "1 minute" : `${count} minutes`),
    retryIn: (remaining) => `Too many attempts. Try again in ${remaining}.`,
    retryUnknown: "Too many attempts. Wait a moment and try again.",
  },
  states: {
    errorTitle: "Could not load",
    retry: "Try again",
    noMethods: {
      title: "This store has not opened access yet",
      description:
        "No way of signing in is switched on right now. Contact the store to get access.",
    },
    noPassword: {
      title: "This store does not use passwords",
      description: "Sign in with one of the available providers to reach your account.",
    },
    signupClosed: {
      title: "E-mail sign-up is closed",
      description:
        "This store does not open e-mail sign-up. You can still sign in with a provider.",
    },
    accountHasNoPassword: {
      title: "Your account has no password yet",
      description: "You signed in with a provider. Create a password to sign in either way.",
    },
  },
};
