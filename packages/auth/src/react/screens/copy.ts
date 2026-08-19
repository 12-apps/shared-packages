import type { EmailAuthFailure } from "../../email-credentials/types";

/**
 * Every refusal a SCREEN has to render.
 *
 * Wider than {@link EmailAuthFailure} by one: the browser client answers
 * `"unknown"` for a response it could not read as a refusal at all — a proxy
 * error page, a 500, a deploy mid-flight. A screen must still say something
 * then, so the copy table covers it.
 */
export type EmailAuthScreenReason = EmailAuthFailure | "unknown";

/**
 * Every word these screens put on a page, supplied by the host.
 *
 * ## Why there is no default
 *
 * This package ships mechanism and layout; the words belong to the product.
 * A default set would have to be in SOME language, and the failure mode of a
 * default is silent: a host that forgets to override one group renders English
 * at a Brazilian shopper, and nothing fails until somebody sees it. Requiring
 * the whole table makes that a type error at the call site instead.
 *
 * It is also the reason these screens are worth sharing at all. The previous
 * version of this code lived in one host with its sentences inlined, which made
 * it unusable by any other — the layout was general, the strings were not, and
 * nothing separated them.
 *
 * Interpolating entries are FUNCTIONS rather than templates with placeholders.
 * A `"{email}"` convention needs a substituter, and a typo in the placeholder
 * survives to production as literal braces on screen; a function that takes the
 * address cannot be called wrong.
 */
export interface EmailAuthCopy {
  /**
   * What each refusal says. Exhaustive over {@link EmailAuthScreenReason}, so
   * adding a code to this package is a type error in every host rather than an
   * `undefined` on somebody's screen.
   */
  failures: Record<EmailAuthScreenReason, string>;
  passwordField: {
    show: string;
    hide: string;
    showAria: string;
    hideAria: string;
  };
  signIn: {
    emailLabel: string;
    passwordLabel: string;
    submit: string;
    forgotPassword: string;
    failureTitle: string;
    unverifiedTitle: string;
    unverifiedDescription: string;
    resentDescription: string;
    resend: string;
  };
  signUp: {
    nameLabel: string;
    emailLabel: string;
    passwordLabel: string;
    passwordHint: string;
    submit: string;
    failureTitle: string;
    sentTitle: string;
    sentDescription: (email: string) => string;
  };
  forgotPassword: {
    title: string;
    intro: string;
    emailLabel: string;
    submit: string;
    backToLogin: string;
    failureTitle: string;
    sentTitle: string;
    sentAlertTitle: string;
    sentDescription: (email: string) => string;
  };
  resetPassword: {
    title: string;
    intro: string;
    newPasswordLabel: string;
    confirmationLabel: string;
    mismatch: string;
    submit: string;
    failureTitle: string;
    okAlertTitle: string;
    invalidAlertTitle: string;
    doneTitle: string;
    doneMessage: string;
    doneAction: string;
    missingTokenMessage: string;
    expiredMessage: string;
    requestNewLink: string;
  };
  verifyEmail: {
    verifying: string;
    doneTitle: string;
    failedTitle: string;
    successAlertTitle: string;
    successDescription: string;
    failedAlertTitle: string;
    continueSignIn: string;
    continueBack: string;
  };
  securityCard: {
    addTitle: string;
    changeTitle: string;
    addIntro: string;
    changeIntro: string;
    currentPasswordLabel: string;
    newPasswordLabelAdd: string;
    newPasswordLabelChange: string;
    confirmationLabel: string;
    mismatch: string;
    submitAdd: string;
    submitChange: string;
    savedTitleAdd: string;
    savedTitleChange: string;
    savedDescription: string;
    failureTitle: string;
  };
}

/**
 * The sentence for a refusal, with the broken password rules appended when the
 * server listed them.
 *
 * All of them at once rather than the first: a form that reveals one
 * requirement per attempt is a guessing game, and the person has to satisfy
 * every rule anyway.
 */
export function failureMessage(
  copy: EmailAuthCopy,
  reason: EmailAuthScreenReason,
  violations?: readonly string[] | null,
): string {
  // `?? unknown` is not dead code under `noUncheckedIndexedAccess`: the reason
  // arrives from the network, so a code this package added after the host's
  // bundle was built reaches here as a string the table has no row for.
  const base = copy.failures[reason] ?? copy.failures.unknown;
  if (reason === "weak-password" && violations && violations.length > 0) {
    return `${base} ${violations.join(" ")}`;
  }
  return base;
}
