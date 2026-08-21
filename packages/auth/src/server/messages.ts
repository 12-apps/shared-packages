import type { EmailAuthFailure } from "../email-credentials/types";
import type { PasswordPolicyViolation } from "../password";

/**
 * What a refusal SAYS, and what it answers with.
 *
 * The two halves are deliberately separated. The HTTP status is mechanism —
 * `rate-limited` is 429 in every app that ever mounts this — so the package
 * owns it and no host can get it wrong. The sentence is copy, so the host
 * chooses it, by picking a bundled locale or writing its own.
 */

/**
 * One sentence per refusal, in the language the deployment speaks — plus one
 * per broken password rule.
 *
 * The `violations` half is not decoration. `checkPassword` answers in CODES
 * (`too-short`, `needs-number`), which is what makes the policy portable; a
 * host that did not translate them showed `too-short` to a shopper, and that is
 * exactly what happened before this field existed. Making it part of the type
 * turns a forgotten translation into a compile error.
 */
export interface EmailAuthMessages extends Record<EmailAuthFailure, string> {
  /**
   * What each broken rule says. ALL of them are listed at once rather than the
   * first: a form that reveals one requirement per attempt is a guessing game,
   * and the person has to satisfy every rule anyway.
   */
  violations: Record<PasswordPolicyViolation, string>;
}

/**
 * The status each refusal answers with.
 *
 * Not configurable, on purpose: a host that answered 200 for `rate-limited`
 * would break every client's error handling, and there is no deployment for
 * which a different number is right.
 *
 * Three lines are worth defending.
 *
 * `no-account` is 200 rather than 404, and it is the most important one here —
 * see the note on the sign-up and reset flows. Telling a caller "no such
 * address" turns either endpoint into a directory anyone can walk.
 *
 * `invalid-credentials` is 401 and `email-not-verified` 403, because the two
 * are genuinely different events: the first is "I do not know who you are", the
 * second is "I do, and you are not permitted yet". A client that collapsed them
 * could not offer to resend a confirmation link.
 *
 * `current-password-invalid` is 403 for the same reason, and NOT 401. It can
 * only happen inside an authenticated session — somebody changing a password
 * they already have — so the session is valid and it is the ACTION that is
 * refused. 401 there is actively dangerous: it is the status every SPA's fetch
 * layer is most likely to read as "your session expired", which would sign a
 * person out for mistyping a field on a form they were halfway through.
 */
export const EMAIL_AUTH_STATUS: Record<EmailAuthFailure, number> = {
  "method-disabled": 403,
  "invalid-email": 400,
  "weak-password": 400,
  "email-taken": 409,
  "invalid-credentials": 401,
  "email-not-verified": 403,
  "token-invalid": 400,
  "rate-limited": 429,
  "current-password-required": 400,
  "current-password-invalid": 403,
  "no-account": 200,
};
