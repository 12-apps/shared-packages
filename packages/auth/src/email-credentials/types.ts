import type { PasswordPolicy } from "../password";

/**
 * The vocabulary of the e-mail + password flow: the ports a host plugs in, and
 * the results it maps to HTTP.
 *
 * Everything here is deliberately free of any host's domain. There is no
 * Prisma model, no table name, no copy in any language, and no HTTP. A host
 * supplies four small ports — a store, a mailer, a settings resolver and
 * (optionally) a rate limiter — and gets the whole flow back as functions.
 */

/** What a token is for. The two purposes never share a namespace. */
export type AuthTokenPurpose = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

/** The account, as this flow needs to see it. A host's row is much wider. */
export interface EmailCredentialUser {
  id: string;
  email: string;
  name?: string | null;
  /**
   * The stored hash, or null/absent for an account that has only ever used a
   * social provider. **That absence is the whole reason `setPassword` takes no
   * current password in one of its two branches** — see `createEmailCredentials`.
   */
  passwordHash?: string | null;
  /** When this address was proven to belong to its owner, if ever. */
  emailVerifiedAt?: Date | null;
}

/** A persisted token row, as `findToken` returns it. */
export interface StoredAuthToken {
  userId: string;
  purpose: AuthTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  consumedAt?: Date | null;
}

/** What the flow persists. Every method is one statement in a host's database. */
export interface EmailCredentialsStore {
  findByEmail(email: string): Promise<EmailCredentialUser | null>;
  findById(id: string): Promise<EmailCredentialUser | null>;
  /** Create the account. The e-mail is already normalised and the hash already computed. */
  createUser(input: {
    email: string;
    name?: string | null;
    passwordHash: string;
    emailVerifiedAt?: Date | null;
  }): Promise<EmailCredentialUser>;
  setPasswordHash(userId: string, passwordHash: string): Promise<void>;
  markEmailVerified(userId: string, verifiedAt: Date): Promise<void>;
  saveToken(input: {
    userId: string;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findToken(
    purpose: AuthTokenPurpose,
    tokenHash: string,
  ): Promise<StoredAuthToken | null>;
  /**
   * Stamp the token consumed, and answer whether THIS call is the one that did
   * it.
   *
   * The return value is the single-use guarantee and it must come from the
   * database, not from a prior read: two clicks of the same link race, both
   * read an unconsumed row, and without a conditional write both succeed. The
   * host's implementation is an `UPDATE … WHERE consumed_at IS NULL` and this
   * returns whether it affected a row.
   */
  consumeToken(purpose: AuthTokenPurpose, tokenHash: string, consumedAt: Date): Promise<boolean>;
  /**
   * Drop every outstanding token of a purpose for a user.
   *
   * Called when a password is set by any route: an old reset link must stop
   * working the moment the password it would have changed is changed by
   * someone else.
   */
  deleteTokens(userId: string, purpose: AuthTokenPurpose): Promise<void>;
}

/** One message the flow asks the host to deliver. The host writes the copy. */
export interface AuthEmailMessage {
  to: string;
  name?: string | null;
  /** The absolute link to put in the message. */
  link: string;
  /** The raw token, for a host whose template shows a code instead of a link. */
  token: string;
  expiresAt: Date;
}

/**
 * The mailer port.
 *
 * The flow decides WHEN an e-mail is warranted and what is in the link; the
 * host decides what the message says, in its own language and brand. That split
 * is why this package can ship to a Portuguese storefront and an English
 * back-office without carrying a translation table.
 */
export interface EmailCredentialsMailer {
  sendVerification(message: AuthEmailMessage): Promise<void>;
  sendPasswordReset(message: AuthEmailMessage): Promise<void>;
  /**
   * Someone tried to register an address that already has an account.
   *
   * Sent INSTEAD of a verification mail, and it is what keeps sign-up from
   * being a user-enumeration oracle: the caller gets the same answer either
   * way, and the person who actually owns the address is the only one who
   * learns anything — that somebody tried, and how to reset if it was them.
   */
  sendAccountExists(message: AuthEmailMessage): Promise<void>;
  /** Optional courtesy notice after a successful password change. */
  sendPasswordChanged?(message: Omit<AuthEmailMessage, "link" | "token" | "expiresAt">): Promise<void>;
}

/**
 * The two switches a platform operator owns, read fresh on every call.
 *
 * Read fresh — not captured at construction — because both are runtime
 * settings a superadmin flips in a browser and expects to take effect on the
 * next request, not on the next deploy.
 */
export interface EmailAuthSettings {
  /** Is signing in with an e-mail and password offered at all? */
  enabled: boolean;
  /**
   * Must a new account prove it owns the address before it can sign in?
   *
   * This is not only a security setting, it changes the SIGN-UP CONTRACT:
   *
   * - **On** — sign-up is non-enumerating. A taken address and a free one
   *   produce the identical answer, and the difference is visible only in the
   *   inbox of whoever actually owns it.
   * - **Off** — a new account can sign in immediately, so sign-up must be able
   *   to say "that address is taken". The deployment trades the
   *   anti-enumeration property for the shorter funnel; that trade is exactly
   *   what the switch is choosing, and it is worth knowing that is what is
   *   being chosen.
   */
  requireEmailVerification: boolean;
}

export type EmailAuthSettingsResolver = () =>
  | EmailAuthSettings
  | Promise<EmailAuthSettings>;

/**
 * Optional throttle. Returns `false` when the caller has spent its budget.
 *
 * A password-reset endpoint with no limiter is a free mail cannon pointed at
 * any address an attacker names, so the seam is here rather than left to each
 * host to remember. Absent, the flow runs unthrottled and says so.
 */
export interface AuthRateLimiter {
  check(key: string): Promise<boolean>;
}

/** Every way an operation can refuse. Hosts map these to status codes and copy. */
export type EmailAuthFailure =
  | "method-disabled"
  | "invalid-email"
  | "weak-password"
  | "email-taken"
  | "invalid-credentials"
  | "email-not-verified"
  | "token-invalid"
  | "rate-limited"
  | "current-password-required"
  | "current-password-invalid"
  | "no-account";

export interface EmailAuthRefusal {
  ok: false;
  reason: EmailAuthFailure;
  /** Populated when `reason` is `weak-password`, so a host can say which rule. */
  violations?: readonly string[];
}

export interface SignUpSuccess {
  ok: true;
  /**
   * `verification-sent` — an e-mail went out and the account cannot sign in
   * yet. Also the answer when the address was already taken, which is the
   * point.
   *
   * `signed-up` — verification is off; these credentials work right now.
   */
  status: "verification-sent" | "signed-up";
  /** Absent for `verification-sent`, because that answer must not reveal a user. */
  user?: EmailCredentialUser;
}

export interface AuthenticatedResult {
  ok: true;
  user: EmailCredentialUser;
}

export interface AcknowledgedResult {
  ok: true;
}

export type SignUpResult = SignUpSuccess | EmailAuthRefusal;
export type AuthenticateResult = AuthenticatedResult | EmailAuthRefusal;
export type AcknowledgeResult = AcknowledgedResult | EmailAuthRefusal;

/** What {@link createEmailCredentials} takes. Ports first, then tuning. */
export interface EmailCredentialsConfig {
  store: EmailCredentialsStore;
  mailer: EmailCredentialsMailer;
  /** The two operator switches. A plain object is accepted for a fixed policy. */
  settings: EmailAuthSettings | EmailAuthSettingsResolver;
  /**
   * The absolute origin links are built against — the PUBLIC one, for the same
   * reason `createApiAuth`'s `authUrl` is: a link built against an internal
   * hostname reaches nobody's browser.
   */
  appUrl: string;
  /** Page that finishes verification. Defaults to `/verify-email`. */
  verifyPath?: string;
  /** Page that takes the new password. Defaults to `/reset-password`. */
  resetPath?: string;
  /** Page a "you already have an account" mail points at. Defaults to `/login`. */
  loginPath?: string;
  /** Password rules. See {@link PasswordPolicy}. */
  passwordPolicy?: PasswordPolicy;
  /** Verification-link lifetime. Defaults to 24 hours. */
  verificationTtlMs?: number;
  /** Reset-link lifetime. Defaults to 1 hour — shorter on purpose; it is stronger. */
  resetTtlMs?: number;
  rateLimiter?: AuthRateLimiter;
  /** "Now", for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}
