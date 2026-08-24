import type { EmailAuthCopy } from "./copy";

/**
 * Everything these screens say, in US English — the second pack.
 *
 * Still passed by name, never applied by default:
 *
 * ```ts
 * createEmailAuthScreens({ client, useSession, copy: EN_US });
 * ```
 *
 * The failure sentences are deliberately NOT copies of the server's, and the
 * translation preserves that split. The server's message answers an API caller;
 * these answer a person looking at a specific form, and the two differ where
 * context lets the screen be more useful — "an account already exists" on the
 * SIGN-UP form can point at the sign-in link, while the same code reaching an
 * API client cannot.
 *
 * Two sentences carry a security property rather than only meaning, and the
 * English keeps the shape rather than the more natural phrasing:
 *
 *  - `forgotPassword.sentDescription` says a link went out IF the address is
 *    registered. An honest "we could not find that e-mail" would let anyone
 *    check who has an account here.
 *  - `verification-unavailable` says what happened and who can help, and
 *    nothing about the deployment: the person at the form cannot fix a missing
 *    provider, and naming it tells an attacker which box is half-built.
 */
export const EN_US: EmailAuthCopy = {
  failures: {
    "method-disabled": "Signing in with an e-mail and password is switched off right now.",
    "invalid-email": "Enter a valid e-mail address.",
    "weak-password": "Choose a stronger password.",
    "email-taken": "An account with this e-mail address already exists. Try signing in.",
    "invalid-credentials": "Wrong e-mail address or password.",
    "email-not-verified": "Confirm your e-mail address to sign in.",
    "token-invalid": "That link has expired or has already been used. Ask for a new one.",
    "rate-limited": "Too many attempts. Wait a few minutes.",
    "current-password-required": "Enter your current password.",
    "current-password-invalid": "That current password is wrong.",
    "no-account": "Account not found.",
    "verification-unavailable":
      "Sign-up could not be completed right now. Try again later, or contact support.",
    unknown: "That could not be completed. Try again.",
  },
  dismissFailure: "Dismiss",
  passwordField: {
    show: "Show",
    hide: "Hide",
    showAria: "Show password",
    hideAria: "Hide password",
  },
  signIn: {
    emailLabel: "E-mail",
    passwordLabel: "Password",
    submit: "Sign in",
    forgotPassword: "I forgot my password",
    failureTitle: "Could not sign in",
    unverifiedTitle: "Confirm your e-mail address",
    unverifiedDescription:
      "Your password is right, but your e-mail address still needs confirming before you can sign in.",
    resentDescription: "We have sent a new link. Check your inbox.",
    resend: "Send the confirmation link again",
  },
  signUp: {
    nameLabel: "Your name",
    emailLabel: "E-mail",
    passwordLabel: "Password",
    // The rule stated here has to match what the server enforces; it is the
    // package's own floor, not host config.
    passwordHint: "At least 8 characters, with a letter and a number.",
    submit: "Create account",
    failureTitle: "Could not create the account",
    sentTitle: "Check your e-mail",
    sentDescription: (email) =>
      `We have sent a confirmation link to ${email}. Once you confirm it, you can sign in.`,
  },
  forgotPassword: {
    title: "Forgotten your password?",
    intro: "Give us your e-mail address and we will send a link to set a new password.",
    emailLabel: "E-mail",
    submit: "Send the link",
    backToLogin: "Back to sign in",
    failureTitle: "Could not send it",
    sentTitle: "Check your e-mail",
    sentAlertTitle: "Link sent",
    sentDescription: (email) =>
      `If an account exists for ${email}, we have sent a link to set a new password. The link lasts 1 hour.`,
  },
  resetPassword: {
    title: "Set a new password",
    intro: "Choose a password of at least 8 characters, including a letter and a number.",
    newPasswordLabel: "New password",
    confirmationLabel: "Repeat the new password",
    mismatch: "The passwords do not match.",
    submit: "Save the new password",
    failureTitle: "Could not change it",
    okAlertTitle: "Done",
    invalidAlertTitle: "Invalid link",
    doneTitle: "Password changed",
    doneMessage: "Your new password is live. Sign in with it to continue.",
    doneAction: "Sign in",
    missingTokenMessage: "This address carries no valid code. Ask for a new link.",
    expiredMessage: "That link has expired or has already been used. Ask for a new one.",
    requestNewLink: "Ask for a new link",
  },
  verifyEmail: {
    verifying: "Confirming your e-mail address...",
    doneTitle: "E-mail confirmed",
    failedTitle: "Could not confirm it",
    successAlertTitle: "Done",
    successDescription: "Your e-mail address is confirmed. You can now sign in with your password.",
    failedAlertTitle: "Invalid link",
    continueSignIn: "Sign in",
    continueBack: "Back to sign in",
  },
  securityCard: {
    addTitle: "Create a password",
    changeTitle: "Change your password",
    addIntro:
      "You sign in with a social account. Create a password so you can also sign in with an e-mail and password — both methods keep working.",
    changeIntro: "Choose a new password. You can still sign in with your social account.",
    currentPasswordLabel: "Current password",
    newPasswordLabelAdd: "Your password",
    newPasswordLabelChange: "New password",
    confirmationLabel: "Repeat the password",
    mismatch: "The passwords do not match.",
    submitAdd: "Create password",
    submitChange: "Save new password",
    savedTitleAdd: "Password created",
    savedTitleChange: "Password changed",
    savedDescription: "Done. You can now sign in with your e-mail address and your new password.",
    failureTitle: "Could not save it",
  },
};
