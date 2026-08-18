import { hashPassword, verifyPassword } from "../password";
import { hashToken, isTokenExpired } from "../tokens";
import {
  checkPassword,
  guardEntry,
  issueLink,
  normalizeEmail,
  refuse,
  type EmailCredentialsContext,
} from "./context";
import type { AcknowledgeResult, EmailAuthRefusal } from "./types";

/**
 * Losing a password, and setting one — including the case this whole feature
 * exists for: an account created through Google that wants a password too.
 *
 * ## The link is proof of address
 *
 * `resetPassword` marks the address verified on success, and that is not a
 * convenience. Clicking a link delivered to an inbox proves control of that
 * inbox at least as well as clicking a verification link does — they are the
 * same act. Without this an unverified account that resets its password lands
 * in a dead end: correct password, still refused, and the only way out is a
 * second e-mail it has no reason to expect.
 */

/**
 * Ask for a reset link. **Always acknowledges.**
 *
 * A truthful "no such account" here is a user-enumeration oracle that needs no
 * credentials at all, so the caller learns nothing and only the inbox does.
 */
export async function requestPasswordReset(
  ctx: EmailCredentialsContext,
  rawEmail: string,
): Promise<AcknowledgeResult> {
  const email = normalizeEmail(rawEmail);
  const blocked = await guardEntry(ctx, email, `reset:${email}`);
  if (blocked) return blocked;

  const user = await ctx.store.findByEmail(email);
  if (!user) return { ok: true };

  // Note there is no `user.passwordHash` check. A Google-only account CAN ask
  // for a reset link, and that is the intended way for someone who has
  // forgotten they used Google to end up with a password — the link sets one.
  const issued = await issueLink(ctx, user.id, "PASSWORD_RESET");
  await ctx.mailer.sendPasswordReset({
    to: user.email,
    name: user.name,
    link: issued.link,
    token: issued.token,
    expiresAt: issued.expiresAt,
  });
  return { ok: true };
}

/**
 * Spend a reset token and set the new password.
 *
 * Two parameters rather than one `{ token, password }` object: they are two
 * different credentials that merely arrive in the same request, and the token
 * is spent while the password is stored. Bagging them together suggests a
 * cohesion they do not have.
 *
 * (The split was first made while chasing a CodeQL
 * `js/insufficient-password-hash` alert on {@link hashToken}, on the theory
 * that taint reached `.token` through a `password` sibling property. That
 * theory was wrong — the source was the string `"password-reset"` used as a
 * label in the tests — and the shape is kept only because it reads better.)
 */
export async function resetPassword(
  ctx: EmailCredentialsContext,
  token: string,
  newPassword: string,
): Promise<AcknowledgeResult> {
  const { enabled } = await ctx.readSettings();
  if (!enabled) return refuse("method-disabled");

  const weak = checkPassword(ctx, newPassword);
  if (weak) return weak;

  const tokenHash = hashToken(token);
  const row = await ctx.store.findToken("PASSWORD_RESET", tokenHash);
  if (!row || row.consumedAt || isTokenExpired(row.expiresAt, ctx.now())) {
    return refuse("token-invalid");
  }
  const consumed = await ctx.store.consumeToken("PASSWORD_RESET", tokenHash, ctx.now());
  if (!consumed) return refuse("token-invalid");

  const user = await ctx.store.findById(row.userId);
  if (!user) return refuse("token-invalid");

  await ctx.store.setPasswordHash(user.id, await hashPassword(newPassword));
  // Every other outstanding reset link dies with this one: whoever asked for
  // them is not necessarily whoever just used one.
  await ctx.store.deleteTokens(user.id, "PASSWORD_RESET");
  if (!user.emailVerifiedAt) {
    await ctx.store.markEmailVerified(user.id, ctx.now());
    await ctx.store.deleteTokens(user.id, "EMAIL_VERIFICATION");
  }
  await ctx.mailer.sendPasswordChanged?.({ to: user.email, name: user.name });
  return { ok: true };
}

/**
 * Confirm the caller still knows the CURRENT password before replacing it.
 *
 * Split out because it is the entire difference between this flow's two
 * branches, and the branch is chosen by whether a hash exists rather than by
 * anything the caller says.
 */
async function authorizeChange(
  currentHash: string | null | undefined,
  currentPassword: string | undefined,
): Promise<EmailAuthRefusal | null> {
  if (!currentHash) return null;
  if (!currentPassword) return refuse("current-password-required");
  if (!(await verifyPassword(currentPassword, currentHash))) {
    return refuse("current-password-invalid");
  }
  return null;
}

/**
 * Set a password for a signed-in account.
 *
 * Two branches, decided by the account rather than by the request:
 *
 * - **The account already has a password** — this is a change, and it needs the
 *   current one. Without that, a borrowed browser session becomes a permanent
 *   takeover.
 * - **The account has none** — it was created through Google (or Facebook, or
 *   Apple). This is the "I would also like to sign in with a password" flow,
 *   and there is no current password to ask for; the live session IS the proof.
 *   Asking for one anyway would make the feature impossible to use, which is
 *   the mistake worth naming here.
 *
 * The caller must have already authenticated the session — this takes a user
 * id, not credentials, and will happily set a password for whoever it is given.
 */
export async function setPassword(
  ctx: EmailCredentialsContext,
  input: { userId: string; password: string; currentPassword?: string },
): Promise<AcknowledgeResult> {
  const { enabled } = await ctx.readSettings();
  if (!enabled) return refuse("method-disabled");

  const user = await ctx.store.findById(input.userId);
  if (!user) return refuse("no-account");

  const unauthorized = await authorizeChange(user.passwordHash, input.currentPassword);
  if (unauthorized) return unauthorized;

  const weak = checkPassword(ctx, input.password);
  if (weak) return weak;

  await ctx.store.setPasswordHash(user.id, await hashPassword(input.password));
  await ctx.store.deleteTokens(user.id, "PASSWORD_RESET");
  // A social account's address was proven by the provider that vouched for it,
  // so adding a password does not put it back into an unverified state.
  if (!user.emailVerifiedAt) await ctx.store.markEmailVerified(user.id, ctx.now());
  await ctx.mailer.sendPasswordChanged?.({ to: user.email, name: user.name });
  return { ok: true };
}

/**
 * Does this account have a password at all?
 *
 * The security screen asks so it can render "add a password" or "change your
 * password", and it is why the flow needs no client-side guess about which the
 * account is. Answers for the SIGNED-IN user only — there is no address
 * argument, so it cannot be turned into an enumeration probe.
 */
export async function hasPassword(
  ctx: EmailCredentialsContext,
  userId: string,
): Promise<boolean> {
  const user = await ctx.store.findById(userId);
  return Boolean(user?.passwordHash);
}
