/**
 * What each story must actually put on screen.
 *
 * "It mounted without throwing" is not the claim worth testing. Every screen
 * here catches a dead wire into a refusal banner, so a suite that stopped at
 * `not.toThrow()` would stay green with the client's paths deliberately broken
 * — every story rendering the same red alert. So each story names a marker that
 * exists ONLY when its own pinned state rendered: a testid, or a sentence from
 * the story copy table.
 *
 * A new story fails until it has a row here, and a row naming a story that no
 * longer exists fails too.
 */
export interface RenderExpectation {
  /** Testids that must be present once the mount (and any `play`) has settled. */
  testIds?: readonly string[];
  /** Sentences that must appear in the rendered text. */
  text?: readonly string[];
  /** Testids that must NOT be present — the half that catches a wrong state. */
  absentTestIds?: readonly string[];
  /** Text that must NOT appear. */
  absentText?: readonly string[];
  /** This story pins an EMPTY render. Nothing at all may be on screen. */
  empty?: boolean;
}

export const EXPECTATIONS: Record<string, RenderExpectation> = {
  "PasswordField/Empty": { testIds: ["story-password", "story-password-toggle"] },
  "PasswordField/Filled": { testIds: ["story-password"] },
  "PasswordField/Mismatch": {
    testIds: ["story-password"],
    text: ["The passwords do not match."],
  },

  "Shared/WrongPassword": { text: ["Wrong e-mail or password."] },
  "Shared/WeakPassword": {
    // The violations are appended to the base sentence, not shown instead of it.
    text: ["Choose a stronger password.", "At least 8 characters.", "Include a number."],
  },
  "Shared/Unknown": { text: ["That did not go through. Try again."] },
  // Renders nothing for a null reason — the whole reason callers drop it in
  // unconditionally instead of guarding every use site.
  "Shared/NoFailure": { empty: true },
  "Shared/Link": { testIds: ["story-link"], text: ["I forgot my password"] },

  "VerifyEmail/Confirmed": {
    testIds: ["verify-success", "verify-continue"],
    absentTestIds: ["verify-failed"],
  },
  "VerifyEmail/Expired": {
    testIds: ["verify-failed"],
    text: ["This link has expired or was already used. Ask for a new one."],
    absentTestIds: ["verify-success"],
  },
  "VerifyEmail/NoTokenInTheLink": {
    testIds: ["verify-failed"],
    absentTestIds: ["verify-success"],
  },
  "VerifyEmail/MethodDisabled": {
    testIds: ["verify-failed"],
    text: ["Signing in with a password is switched off right now."],
  },

  "SecurityCard/AddingTheFirstPassword": {
    testIds: ["password-security-card", "new-password", "save-password"],
    text: ["Create a password"],
    // The whole point of this state: no current password is demanded.
    absentTestIds: ["current-password"],
  },
  "SecurityCard/ChangingAnExistingPassword": {
    testIds: ["password-security-card", "current-password", "new-password"],
    text: ["Change your password"],
  },
  // Switched off platform-wide: the card renders nothing rather than offering a
  // password nobody could sign in with.
  "SecurityCard/MethodSwitchedOff": { empty: true },

  "SignIn/Empty": {
    testIds: ["email-password-form", "login-email", "login-password", "login-submit"],
  },
  "SignIn/WrongPassword": {
    testIds: ["email-password-form"],
    text: ["Wrong e-mail or password."],
    absentTestIds: ["resend-verification"],
  },
  "SignIn/AwaitingConfirmation": {
    // The branch that is not merely an error: it offers the one action that helps.
    testIds: ["resend-verification"],
    text: ["Confirm your e-mail"],
  },
  "SignIn/RateLimited": { text: ["Too many attempts. Wait a few minutes."] },

  "ForgotPassword/Empty": {
    testIds: ["forgot-password-form", "forgot-email", "forgot-submit"],
  },
  "ForgotPassword/LinkSent": {
    testIds: ["back-to-login"],
    // States the CONDITION rather than confirming the address exists.
    text: ["If an account exists for ana@example.com"],
    absentTestIds: ["forgot-password-form"],
  },
  "ForgotPassword/RateLimited": {
    testIds: ["forgot-password-form"],
    text: ["Too many attempts. Wait a few minutes."],
  },

  "ResetPassword/Form": {
    testIds: ["reset-password-form", "reset-password", "reset-password-confirm"],
  },
  "ResetPassword/NoTokenInTheLink": {
    testIds: ["request-new-link"],
    text: ["This address carries no valid code. Ask for a new link."],
    absentTestIds: ["reset-password-form"],
  },
  "ResetPassword/SpentLink": {
    testIds: ["request-new-link"],
    text: ["This link has expired or was already used."],
  },
  "ResetPassword/WeakPassword": {
    // Refused by policy, and the form is STILL there — the link was not spent.
    testIds: ["reset-password-form"],
    text: ["Choose a stronger password."],
  },
  "ResetPassword/Done": {
    testIds: ["reset-done"],
    text: ["Password changed"],
    absentTestIds: ["reset-password-form"],
  },

  "SignUp/Empty": {
    testIds: ["email-signup-form", "signup-email", "signup-password", "signup-submit"],
  },
  "SignUp/VerificationSent": {
    testIds: ["signup-verification-sent"],
    text: ["We sent a confirmation link to ana@example.com"],
    absentTestIds: ["email-signup-form"],
  },
  // Deliberately identical to the story above — that is the security property.
  "SignUp/AddressAlreadyRegistered": {
    testIds: ["signup-verification-sent"],
    text: ["We sent a confirmation link to ana@example.com"],
    absentText: ["already an account"],
  },
  "SignUp/AddressTakenWithVerificationOff": {
    testIds: ["email-signup-form"],
    text: ["There is already an account with this e-mail."],
  },
  "SignUp/WeakPassword": {
    testIds: ["email-signup-form"],
    text: ["Choose a stronger password.", "At least 8 characters."],
  },
};
