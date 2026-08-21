import type { CheckEmailCopy } from "./check-email";
import type { RateLimitCopy } from "./rate-limit";

/**
 * Every sentence this surface says, as one required record.
 *
 * REQUIRED, and never defaulted. A pack chosen by silence is how a deployment
 * ends up showing a language its shoppers do not read — and this package now
 * refuses that everywhere else too (the mail pack became required for the same
 * reason). A host that has nothing to say about the phrasing names
 * `PT_BR_ACCESS`; a host that does passes its own.
 *
 * The EMPTY states carry the weight here. Each is a real configuration rather
 * than a placeholder, so each gets a sentence AND a way forward — a screen that
 * says "this store has no e-mail sign-up" and stops is a screen somebody
 * closes.
 */
export interface AccessCopy {
  /** The "confira seu e-mail" panel. */
  checkEmail: CheckEmailCopy;
  /** How a remaining wait is said. */
  rateLimit: RateLimitCopy;
  /** The three states the gate can be in, besides content. */
  states: {
    /** Heading on the error state. */
    errorTitle: string;
    /** The retry button inside it. */
    retry: string;
    /** Nothing enabled at all — the store accepts no sign-in method. */
    noMethods: { title: string; description: string };
    /** E-mail sign-in is off; providers may still be on. */
    noPassword: { title: string; description: string };
    /** Sign-up by e-mail is closed. */
    signupClosed: { title: string; description: string };
    /** The account has no password yet — a provider-only account. */
    accountHasNoPassword: { title: string; description: string };
  };
}
