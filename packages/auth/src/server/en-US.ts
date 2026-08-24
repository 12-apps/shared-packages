import type { EmailAuthMessages } from "./messages";

/**
 * US English — the second locale this ships with.
 *
 * The `no-account` and `verification-unavailable` sentences carry properties
 * rather than just meaning, and the translation holds both:
 *
 *  - `no-account` is the SAME answer whether or not the address has an account.
 *    That is what stops password reset from enumerating users, so the English
 *    keeps the conditional phrasing rather than the more natural "we sent you
 *    an e-mail".
 *  - `verification-unavailable` is deliberately vague: a visitor cannot act on
 *    a missing provider, and naming a deployment's absent credentials on a
 *    public sign-up screen tells an attacker which box is half-built.
 */
export const EN_US_MESSAGES: EmailAuthMessages = {
  violations: {
    // The minimum is the package's own floor, so the number is stated here in
    // both languages rather than interpolated — it is not host config.
    "too-short": "Use at least 8 characters.",
    "too-long": "That password is too long.",
    "needs-letter": "Include at least one letter.",
    "needs-number": "Include at least one number.",
    "too-common": "That password is too common. Choose another.",
  },
  "method-disabled": "Signing in with an e-mail and password is unavailable right now.",
  "invalid-email": "Enter a valid e-mail address.",
  "weak-password": "Choose a stronger password.",
  "email-taken": "That e-mail address is already in use.",
  // One message for a wrong address and a wrong password, in both languages:
  // splitting them tells a prober which half was right.
  "invalid-credentials": "Wrong e-mail address or password.",
  "email-not-verified": "Confirm your e-mail address to continue.",
  "token-invalid": "That link is no longer valid. Ask for a new one.",
  "rate-limited": "Too many attempts. Wait a moment and try again.",
  "current-password-required": "Enter your current password.",
  "current-password-invalid": "That current password is wrong.",
  "no-account": "If an account exists, we have e-mailed the instructions.",
  "verification-unavailable":
    "Sign-up could not be completed right now. Try again later, or contact support.",
};
