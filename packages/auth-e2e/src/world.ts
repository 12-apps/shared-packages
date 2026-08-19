import type { BrowserContext, Page } from '@playwright/test';

/**
 * One message the host's mailer actually sent.
 *
 * `text` is the plain-text half deliberately: the HTML one carries the same URL
 * twice (the button and the copy-paste fallback), and taking "the first http…
 * in the document" out of markup is the sort of thing that starts matching a
 * stylesheet.
 */
export interface SentAuthEmail {
  subject: string;
  text: string;
}

/** A user the scenarios need to exist before they start. */
export interface SeedUserInput {
  email: string;
  name: string;
  /** `'google'` for an account that signed up socially and has no password. */
  provider?: string;
  /** Leave unset for an address that has never been confirmed. */
  emailVerified?: boolean;
}

/**
 * Everything these journeys need that is NOT the same in every app.
 *
 * ## Why a port at all
 *
 * The scenarios are portable because every assertion in them reads a test id
 * that `@12-apps/auth`'s own screens render — `forgot-password-form`,
 * `reset-password`, `reset-submit`, `verify-failed`, `save-password`,
 * `current-password` mean the same thing in every consumer, because the same
 * components draw them.
 *
 * What is **not** portable is everything around them: how a user comes to
 * exist, how the two platform switches are flipped, how you read what your
 * mailer sent, and where your app puts its login and account pages. That, and
 * only that, is `AuthWorld`.
 */
export interface AuthWorld {
  /** Create (or overwrite) a user. Called before a scenario's first gesture. */
  seedUser: (page: Page, user: SeedUserInput) => Promise<void>;

  /** Turn the e-mail + password method on or off, platform-wide. */
  setEmailAuthEnabled: (page: Page, enabled: boolean) => Promise<void>;

  /** Turn "a new account must confirm its address" on or off, platform-wide. */
  setRequireVerification: (page: Page, required: boolean) => Promise<void>;

  /**
   * The LAST message your mailer sent to `email`, narrowed by subject.
   *
   * Last rather than first: a scenario that asks for a second link must click
   * the new one, and the old one is expected to be dead.
   *
   * Returning the message your app actually sent — rather than a token the test
   * seeded — is the whole point. A seeded token exercises the consumption while
   * proving nothing about the link a real person receives, and a wrong app URL
   * or a moved path fails only there.
   */
  lastMail: (email: string, subjectContains?: string) => SentAuthEmail | undefined;

  /** Put the browser in a signed-in session for `email`, however you do that. */
  signInAs: (context: BrowserContext, email: string) => Promise<void>;

  /** Drop the session — the scenarios sign out to prove a password works. */
  signOut: (context: BrowserContext) => Promise<void>;

  /** Where your app puts these screens. Paths, relative to the SPA's origin. */
  paths: {
    /** The sign-in screen. */
    login: string;
    /** The create-an-account screen. */
    signup: string;
    /** The "I forgot my password" screen. */
    forgotPassword: string;
    /** The screen carrying the password security card. */
    account: string;
  };

  /**
   * The SUBJECT fragments your mailer uses, because the copy is yours.
   *
   * The journeys ask for "the confirmation mail" and "the reset mail"; only the
   * host knows those are called "Confirme seu e-mail" and "Redefinir sua senha"
   * in its own language.
   */
  subjects: {
    verify: string;
    reset: string;
    /** The one sent when somebody signs up with an address that already exists. */
    alreadyRegistered: string;
  };
}

let installed: AuthWorld | null = null;

/**
 * Install the host's implementation. Call this from a module inside the host's
 * OWN steps glob — playwright-bdd imports every step file before any scenario
 * runs, so a top-level call there is registered in time, in every worker.
 */
export function defineAuthWorld(world: AuthWorld): void {
  installed = world;
}

/**
 * The installed world.
 *
 * Throws rather than degrading: a journey that ran against a half-configured
 * world would fail somewhere deep inside a step with a message about a missing
 * element, and the actual cause — a host that forgot to call
 * {@link defineAuthWorld} — would be several layers away from the error.
 */
export function authWorld(): AuthWorld {
  if (!installed) {
    throw new Error(
      'No AuthWorld installed. Call defineAuthWorld(...) from a module inside ' +
        "this app's bdd `steps` glob — see @12-apps/auth-e2e's README.",
    );
  }
  return installed;
}
