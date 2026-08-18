import type { AccountSecurityData, EmailAuth, EmailAuthClientResult } from "../react/create-email-auth";
import type { PasswordSignInResult } from "../react/password-signin";
import { createEmailAuthScreens, type EmailAuthScreens } from "../react/screens";
import type { EmailAuthCopy, EmailAuthScreenReason } from "../react/screens/copy";
import type { ScreensSession } from "../react/screens/context";

/**
 * The world every story runs in: a client that answers from memory, a session
 * that never leaves the page, and one complete copy table.
 *
 * ## No story may touch the network
 *
 * `stories-render.test.tsx` replaces `globalThis.fetch` with a tripwire and
 * fails if anything calls it. That is the whole point of the story world — a
 * reviewer can look at every state of every screen without a backend, a
 * database or an inbox — so the fake client here is not a convenience, it is
 * the contract those tests enforce.
 *
 * ## The copy is English, and that is deliberate
 *
 * `EmailAuthCopy` has no default, because the words belong to the product (see
 * its docblock). A story therefore has to supply a full table — which makes
 * this file the worked example of the contract, and proves by construction
 * that the screens carry no sentences of their own. A host's own table is the
 * one its users read; this one is only ever seen by developers.
 */

/** A complete copy table. Every field, so a missing one is a compile error here. */
const STORY_COPY: EmailAuthCopy = {
  failures: {
    "method-disabled": "Signing in with a password is switched off right now.",
    "invalid-email": "Enter a valid e-mail address.",
    "weak-password": "Choose a stronger password.",
    "email-taken": "There is already an account with this e-mail. Try signing in.",
    "invalid-credentials": "Wrong e-mail or password.",
    "email-not-verified": "Confirm your e-mail to sign in.",
    "token-invalid": "This link has expired or was already used. Ask for a new one.",
    "rate-limited": "Too many attempts. Wait a few minutes.",
    "current-password-required": "Enter your current password.",
    "current-password-invalid": "That current password is wrong.",
    "no-account": "Account not found.",
    unknown: "That did not go through. Try again.",
  },
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
    failureTitle: "Could not sign you in",
    unverifiedTitle: "Confirm your e-mail",
    unverifiedDescription:
      "Your password is right, but your e-mail still needs confirming before you can sign in.",
    resentDescription: "We sent a new link. Check your inbox.",
    resend: "Send the confirmation link again",
  },
  signUp: {
    nameLabel: "Your name",
    emailLabel: "E-mail",
    passwordLabel: "Password",
    passwordHint: "At least 8 characters, with a letter and a number.",
    submit: "Create account",
    failureTitle: "Could not create the account",
    sentTitle: "Check your e-mail",
    sentDescription: (email) =>
      `We sent a confirmation link to ${email}. Once you confirm it, you can sign in.`,
  },
  forgotPassword: {
    title: "Forgot your password?",
    intro: "Give us your e-mail and we will send a link to choose a new password.",
    emailLabel: "E-mail",
    submit: "Send the link",
    backToLogin: "Back to sign in",
    failureTitle: "Could not send it",
    sentTitle: "Check your e-mail",
    sentAlertTitle: "Link sent",
    // Says what happened without confirming the address exists — see the
    // screen's docblock for why that phrasing is the honest one.
    sentDescription: (email) =>
      `If an account exists for ${email}, we sent it a link to choose a new password. The link is good for 1 hour.`,
  },
  resetPassword: {
    title: "Choose a new password",
    intro: "Pick a password with at least 8 characters, including a letter and a number.",
    newPasswordLabel: "New password",
    confirmationLabel: "Repeat the new password",
    mismatch: "The passwords do not match.",
    submit: "Save the new password",
    failureTitle: "Could not change it",
    okAlertTitle: "Done",
    invalidAlertTitle: "Invalid link",
    doneTitle: "Password changed",
    doneMessage: "Your new password is live. Sign in with it to carry on.",
    doneAction: "Sign in",
    missingTokenMessage: "This address carries no valid code. Ask for a new link.",
    expiredMessage: "This link has expired or was already used. Ask for a new one.",
    requestNewLink: "Ask for a new link",
  },
  verifyEmail: {
    verifying: "Confirming your e-mail...",
    doneTitle: "E-mail confirmed",
    failedTitle: "Could not confirm it",
    successAlertTitle: "Done",
    successDescription: "Your e-mail is confirmed. You can sign in with your password now.",
    failedAlertTitle: "Invalid link",
    continueSignIn: "Sign in",
    continueBack: "Back to sign in",
  },
  securityCard: {
    addTitle: "Create a password",
    changeTitle: "Change your password",
    addIntro:
      "You sign in with your social account. Create a password to also sign in with e-mail and password — both keep working.",
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
    savedDescription: "Done. You can sign in with your e-mail and your new password.",
    failureTitle: "Could not save it",
  },
};

/** A refusal, as the client reports one. */
export function refuse<T>(
  reason: EmailAuthScreenReason,
  violations?: readonly string[],
): EmailAuthClientResult<T> {
  return violations ? { ok: false, reason, violations } : { ok: false, reason };
}

/** Whatever a story wants the client to answer. Anything unset resolves `ok`. */
type ClientOverrides = Partial<EmailAuth>;

const SECURITY: AccountSecurityData = {
  hasPassword: false,
  emailVerified: true,
  enabled: true,
};

/**
 * A client that answers from memory.
 *
 * Every method resolves rather than rejecting, because a refusal is an ordinary
 * answer in this flow and a story about one is a story about what the screen
 * renders — not about an exception.
 */
function fakeClient(overrides: ClientOverrides = {}): EmailAuth {
  return {
    getSettings: () => Promise.resolve({ ok: true, data: { enabled: true, requireEmailVerification: true } }),
    signUp: () => Promise.resolve({ ok: true, data: { status: "verification-sent" } }),
    verifyEmail: () => Promise.resolve({ ok: true, data: null }),
    resendVerification: () => Promise.resolve({ ok: true, data: null }),
    requestPasswordReset: () => Promise.resolve({ ok: true, data: null }),
    resetPassword: () => Promise.resolve({ ok: true, data: null }),
    setPassword: () => Promise.resolve({ ok: true, data: null }),
    getSecurity: () => Promise.resolve({ ok: true, data: SECURITY }),
    ...overrides,
  };
}

/** A session whose sign-in resolves however the story wants. */
export function fakeSession(
  result: PasswordSignInResult = { ok: true, url: "/" },
): () => ScreensSession {
  return () => ({ signInWithPassword: () => Promise.resolve(result) });
}

/** The screens, built the way a host builds them. */
export function storyScreens(
  overrides: ClientOverrides = {},
  session = fakeSession(),
): EmailAuthScreens {
  return createEmailAuthScreens({
    client: fakeClient(overrides),
    copy: STORY_COPY,
    useSession: session,
  });
}

/** The callbacks a screen needs but a story has nowhere to send. */
export const noop = (): void => {};
export const asyncNoop = (): Promise<void> => Promise.resolve();
