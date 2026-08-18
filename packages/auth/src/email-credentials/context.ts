import { checkPasswordPolicy, type PasswordPolicy } from "../password";
import { buildTokenLink, issueToken, type IssuedToken } from "../tokens";
import type {
  AuthTokenPurpose,
  EmailAuthRefusal,
  EmailAuthSettings,
  EmailCredentialsConfig,
  EmailCredentialsMailer,
  EmailCredentialsStore,
} from "./types";

/**
 * The resolved configuration every operation shares, plus the four things they
 * all do: normalise an address, read the switches, check the password rules and
 * mint a link.
 *
 * Split out so each operation file stays about its own flow, and so those four
 * behaviours have exactly one implementation between them — a second
 * `email.trim().toLowerCase()` somewhere is how a lookup starts missing rows
 * that the writer inserted under a different key.
 */

/** Verification links last a day: a person may not read their mail until tomorrow. */
const DEFAULT_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * Reset links last an hour. Shorter on purpose — a reset link is a stronger
 * credential than a verification link (it TAKES the account rather than
 * confirming it), and it is used within minutes of being asked for or not at all.
 */
const DEFAULT_RESET_TTL_MS = 60 * 60 * 1000;

export interface EmailCredentialsContext {
  store: EmailCredentialsStore;
  mailer: EmailCredentialsMailer;
  appUrl: string;
  verifyPath: string;
  resetPath: string;
  loginPath: string;
  passwordPolicy: PasswordPolicy;
  verificationTtlMs: number;
  resetTtlMs: number;
  now: () => Date;
  readSettings: () => Promise<EmailAuthSettings>;
  allow: (key: string) => Promise<boolean>;
}

/** Fold the public config into the shape the operations read. */
export function toContext(config: EmailCredentialsConfig): EmailCredentialsContext {
  const { settings, rateLimiter } = config;
  return {
    store: config.store,
    mailer: config.mailer,
    appUrl: config.appUrl,
    verifyPath: config.verifyPath ?? "/verify-email",
    resetPath: config.resetPath ?? "/reset-password",
    loginPath: config.loginPath ?? "/login",
    passwordPolicy: config.passwordPolicy ?? {},
    verificationTtlMs: config.verificationTtlMs ?? DEFAULT_VERIFICATION_TTL_MS,
    resetTtlMs: config.resetTtlMs ?? DEFAULT_RESET_TTL_MS,
    now: config.now ?? (() => new Date()),
    readSettings: async () =>
      typeof settings === "function" ? await settings() : settings,
    // No limiter configured means no limit — stated here once rather than
    // guarded at four call sites.
    allow: async (key) => (rateLimiter ? rateLimiter.check(key) : true),
  };
}

/**
 * Normalise an address to the single form everything stores and looks up by.
 *
 * Lower-casing the whole address (not only the domain) is a deliberate
 * simplification: the local part is case-sensitive per RFC 5321, but no
 * consumer mail provider honours that, and treating `Ana@x.com` and `ana@x.com`
 * as two accounts produces a support ticket, not a security property.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Is this plausibly an address we could deliver to?
 *
 * Deliberately loose. The only test that actually proves an address exists is
 * sending mail to it and having someone click, which is what the verification
 * flow does — so a stricter regex here buys nothing and rejects valid,
 * unusual-looking addresses.
 */
export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email) && email.length <= 320;
}

/** A refusal, as the one-liner every guard returns. */
export function refuse(
  reason: EmailAuthRefusal["reason"],
  violations?: readonly string[],
): EmailAuthRefusal {
  return violations ? { ok: false, reason, violations } : { ok: false, reason };
}

/**
 * The guard every entry point opens with: is the method on, is the address
 * shaped like one, and is this caller within its budget?
 *
 * `rateKey` is `undefined` for operations with nothing to throttle.
 */
export async function guardEntry(
  ctx: EmailCredentialsContext,
  email: string,
  rateKey?: string,
): Promise<EmailAuthRefusal | null> {
  const settings = await ctx.readSettings();
  if (!settings.enabled) return refuse("method-disabled");
  if (!isPlausibleEmail(email)) return refuse("invalid-email");
  if (rateKey && !(await ctx.allow(rateKey))) return refuse("rate-limited");
  return null;
}

/** Policy check as a refusal, or `null` when the password is acceptable. */
export function checkPassword(
  ctx: EmailCredentialsContext,
  password: string,
): EmailAuthRefusal | null {
  const violations = checkPasswordPolicy(password, ctx.passwordPolicy);
  return violations.length > 0 ? refuse("weak-password", violations) : null;
}

/**
 * Mint a token, persist its hash, and return the raw half with the link built.
 *
 * The two halves never travel together anywhere but this return value: the hash
 * goes to the store inside this function, and the raw token leaves only towards
 * the mailer.
 */
export async function issueLink(
  ctx: EmailCredentialsContext,
  userId: string,
  purpose: AuthTokenPurpose,
): Promise<IssuedToken & { link: string }> {
  const ttlMs = purpose === "PASSWORD_RESET" ? ctx.resetTtlMs : ctx.verificationTtlMs;
  const issued = issueToken({ ttlMs, now: ctx.now() });
  await ctx.store.saveToken({
    userId,
    purpose,
    tokenHash: issued.tokenHash,
    expiresAt: issued.expiresAt,
  });
  const path = purpose === "PASSWORD_RESET" ? ctx.resetPath : ctx.verifyPath;
  return { ...issued, link: buildTokenLink(ctx.appUrl, path, issued.token) };
}
