import { randomBytes } from "node:crypto";

import { hashToken, isTokenExpired } from "../tokens";
import { refuse, type EmailCredentialsContext } from "./context";
import type { AuthenticateResult, EmailCredentialUser, StoredAuthToken } from "./types";

/**
 * The confirmation link that signs its reader in — but only in the browser
 * that signed up (FUT-3474).
 *
 * ## Why the link alone may not open a session
 *
 * Sign-up for an unused address creates the account with the password the
 * CALLER chose. If the link signed in wherever it was opened, an attacker could
 * register `victim@…` with a password they know and wait: the victim clicks the
 * link, is signed in, and starts using an account whose password somebody else
 * holds. So the session needs two things only the person who chose the
 * password has together: the token from the mail, and the binding cookie their
 * browser was handed by the sign-up response.
 *
 * ## How the two are tied without a new column
 *
 * The sign-up stores a second token row, `SIGN_IN_GRANT`, whose hash is the
 * hash of `<verification token>.<binding>`. Neither half finds it on its own:
 * the mail holds the token and not the binding, the browser holds the binding
 * and not the token, and the database holds neither. Spending it is the same
 * conditional write every other token uses, so it works once.
 */

/** Entropy of a binding, in bytes — the same as a mailed token. */
const BINDING_BYTES = 32;

/**
 * Mint a binding value.
 *
 * Minted the same way on both sign-up branches, so the cookie that carries it
 * has the same length whether the address was free or taken.
 */
export function mintBinding(): string {
  return randomBytes(BINDING_BYTES).toString("base64url");
}

/** The lookup key of the grant a verification token and a binding unlock together. */
export function grantHash(token: string, binding: string): string {
  return hashToken(`${token}.${binding}`);
}

/**
 * Keep a destination only when it is a path on this origin.
 *
 * It travels in the mail link, which anyone can edit, so it is read as
 * untrusted. The test is what a BROWSER would do with it, not what it looks
 * like: `//evil.example`, `/\\evil.example` and `/<TAB>/evil.example` all start
 * with one slash and all leave the origin, because URL parsing drops tabs and
 * newlines and reads a backslash as a slash. So any control character or
 * backslash is refused outright, and what is left must resolve on a stand-in
 * origin to that same origin. Over-long values are dropped rather than
 * truncated — half a path is somewhere nobody meant.
 */
export function safeCallbackPath(value: string | null | undefined): string | undefined {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/")) return undefined;
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return undefined;
  const probe = "http://callback.invalid";
  let resolved: URL;
  try {
    resolved = new URL(value, probe);
  } catch {
    return undefined;
  }
  return resolved.origin === probe ? value : undefined;
}

/** Is this grant row usable for this user right now? */
function grantUsable(
  row: StoredAuthToken | null,
  userId: string | null,
  now: Date,
): row is StoredAuthToken {
  if (!row || row.consumedAt || isTokenExpired(row.expiresAt, now)) return false;
  return userId === null || row.userId === userId;
}

/** The unspent grant this token and binding unlock, if any. */
async function findGrant(
  ctx: EmailCredentialsContext,
  token: string,
  binding: string | undefined,
  userId: string | null,
): Promise<StoredAuthToken | null> {
  if (!token || !binding) return null;
  const row = await ctx.store.findToken("SIGN_IN_GRANT", grantHash(token, binding));
  return grantUsable(row, userId, ctx.now()) ? row : null;
}

/**
 * Does the caller hold the binding for this verification token's account?
 *
 * Asked by `verifyEmail` so the page knows whether to sign in, and nothing is
 * spent by asking.
 */
export async function holdsGrant(
  ctx: EmailCredentialsContext,
  token: string,
  binding: string | undefined,
  userId: string,
): Promise<boolean> {
  return (await findGrant(ctx, token, binding, userId)) !== null;
}

/** The account a grant names, once its address has been proven. */
async function verifiedOwner(
  ctx: EmailCredentialsContext,
  userId: string,
): Promise<EmailCredentialUser | null> {
  const user = await ctx.store.findById(userId);
  return user?.emailVerifiedAt ? user : null;
}

/**
 * Open a session from a verification link, in the browser that signed up.
 *
 * Refuses with `token-invalid` for every way it can fail — a missing binding,
 * the wrong one, a spent or expired grant, an address not verified yet — so
 * the answer says nothing about which half was wrong. The address must have
 * been verified first (`verifyEmail`); the grant opens a session, it does not
 * prove anything on its own.
 */
export async function signInWithLink(
  ctx: EmailCredentialsContext,
  token: string,
  binding: string | undefined,
): Promise<AuthenticateResult> {
  const { enabled } = await ctx.readSettings();
  if (!enabled) return refuse("method-disabled");

  const grant = await findGrant(ctx, token, binding, null);
  if (!grant) return refuse("token-invalid");
  const user = await verifiedOwner(ctx, grant.userId);
  if (!user) return refuse("token-invalid");
  // The conditional write is the single-use guarantee, as for every token.
  const spent = await ctx.store.consumeToken("SIGN_IN_GRANT", grant.tokenHash, ctx.now());
  return spent ? { ok: true, user } : refuse("token-invalid");
}
