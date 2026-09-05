import type { AuthPagesCopy } from "./index";
import type { AuthErrorCopy } from "./errors";

/**
 * US English page chrome.
 *
 * Exported but never applied by default: `AuthPagesConfig.copy` stays required.
 */
export const EN_US_PAGES: AuthPagesCopy = {
  login: {
    title: "Sign in",
    subtitle: "Sign in to your account",
    // Just "or": the divider sits between the provider buttons above it and
    // the form below, so it introduces neither.
    providerDivider: "or",
    signupPrompt: "No account yet?",
    signupLink: "Sign up",
  },
  signup: {
    title: "Create account",
    subtitle: "Create your account",
    providerDivider: "or",
    loginPrompt: "Already have an account?",
    loginLink: "Sign in",
  },
};

/**
 * The Auth.js error codes in US English.
 *
 * The KEYS are Auth.js's own codes and are not words — they arrive on the URL.
 * `fallback` still exists because Auth.js may add a code this pack predates; it
 * is the floor, not the common case, and the reason it exists is that a host
 * map knowing four of nine codes sent everyone else to "an unexpected error",
 * which tells somebody locked out precisely nothing.
 */
export const EN_US_AUTH_ERRORS: AuthErrorCopy = {
  AccessDenied: "Sign up and accept the terms to continue.",
  Configuration:
    "Sign-in could not be completed right now (the provider did not answer). Try again in a moment.",
  Verification: "That verification link has expired or has already been used.",
  OAuthSignin: "Sign-in could not be started. Try again.",
  OAuthCallback: "Sign-in could not be completed. Try again.",
  OAuthAccountNotLinked: "That e-mail address is already tied to another account.",
  OAuthCreateAccount: "An account could not be created with that provider.",
  EmailCreateAccount: "An account could not be created with that e-mail address.",
  Callback: "Sign-in could not be completed. Try again.",
  CredentialsSignin: "Wrong e-mail address or password.",
  SessionRequired: "Sign in to continue.",
  fallback: "Something unexpected went wrong. Try again.",
  dismiss: "Dismiss",
  /**
   * `AccessDenied` is not a failure — it is an instruction to sign up first —
   * so it keeps its own heading, and everything else falls back to one.
   */
  titles: {
    AccessDenied: "Sign-up required",
    Verification: "Link expired",
    SessionRequired: "Sign in to continue",
  },
  titleFallback: "Sign-in failed",
};
