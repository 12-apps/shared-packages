import { hashPassword } from "../password";
import { hashToken, isTokenExpired } from "../tokens";
import {
  checkPassword,
  guardEntry,
  issueLink,
  normalizeEmail,
  refuse,
  type EmailCredentialsContext,
} from "./context";
import type {
  AcknowledgeResult,
  EmailCredentialUser,
  SignUpResult,
} from "./types";

/**
 * Registration and proof-of-address: sign up, verify, resend.
 *
 * The one idea worth holding while reading this file is that **sign-up must not
 * answer a question it was not asked**. "Is ana@example.com registered here?"
 * is a question an attacker asks by attempting to register it, and the honest
 * answer to the person typing is indistinguishable from the answer to the
 * person prodding. So when verification is on, both branches below produce the
 * SAME return value and differ only in which e-mail is delivered to the address
 * itself. See `EmailAuthSettings.requireEmailVerification` for the one case
 * where a deployment knowingly trades that away.
 */

export interface SignUpInput {
  email: string;
  password: string;
  name?: string | null;
}

/**
 * The taken-address branch: tell the OWNER, tell the caller nothing.
 *
 * The mail is not a verification mail — verifying would be meaningless, the
 * address is already theirs — it is "somebody tried to sign up as you, here is
 * how to get in if that was you". It carries a reset link because the
 * overwhelmingly common cause is a returning user who forgot they already had
 * an account, and the second most common is one who forgot their password.
 */
async function noticeExistingAccount(
  ctx: EmailCredentialsContext,
  user: EmailCredentialUser,
): Promise<SignUpResult> {
  const issued = await issueLink(ctx, user.id, "PASSWORD_RESET");
  await ctx.mailer.sendAccountExists({
    to: user.email,
    name: user.name,
    link: issued.link,
    token: issued.token,
    expiresAt: issued.expiresAt,
  });
  return { ok: true, status: "verification-sent" };
}

/** Create the account and send it its verification link. */
async function registerPending(
  ctx: EmailCredentialsContext,
  input: SignUpInput,
  email: string,
): Promise<SignUpResult> {
  const user = await ctx.store.createUser({
    email,
    name: input.name ?? null,
    passwordHash: await hashPassword(input.password),
    emailVerifiedAt: null,
  });
  const issued = await issueLink(ctx, user.id, "EMAIL_VERIFICATION");
  await ctx.mailer.sendVerification({
    to: user.email,
    name: user.name,
    link: issued.link,
    token: issued.token,
    expiresAt: issued.expiresAt,
  });
  return { ok: true, status: "verification-sent" };
}

/**
 * Register with an e-mail and a password.
 *
 * With verification ON the two outcomes are indistinguishable to the caller.
 * With it OFF a taken address is refused outright (`email-taken`) — see the
 * setting's own documentation for why that follows rather than being an
 * oversight.
 */
export async function signUp(
  ctx: EmailCredentialsContext,
  input: SignUpInput,
): Promise<SignUpResult> {
  const email = normalizeEmail(input.email);
  const blocked = await guardEntry(ctx, email, `signup:${email}`);
  if (blocked) return blocked;

  const weak = checkPassword(ctx, input.password);
  if (weak) return weak;

  const { requireEmailVerification } = await ctx.readSettings();
  const existing = await ctx.store.findByEmail(email);

  if (existing) {
    if (!requireEmailVerification) return refuse("email-taken");
    return noticeExistingAccount(ctx, existing);
  }

  if (requireEmailVerification) return registerPending(ctx, input, email);

  // Verification off: the account is usable the moment it exists. The address
  // is stamped verified because nothing in this deployment asks for proof of
  // it, and leaving the column null would leave a permanently "unverified"
  // account behind if the switch is later turned on.
  const user = await ctx.store.createUser({
    email,
    name: input.name ?? null,
    passwordHash: await hashPassword(input.password),
    emailVerifiedAt: ctx.now(),
  });
  return { ok: true, status: "signed-up", user };
}

/**
 * Finish verification by spending the token from the link.
 *
 * Deliberately NOT rate-limited by address: the caller has a 256-bit token and
 * no address to be limited by. The token's own unguessability is the control.
 */
export async function verifyEmail(
  ctx: EmailCredentialsContext,
  token: string,
): Promise<AcknowledgeResult> {
  const { enabled } = await ctx.readSettings();
  if (!enabled) return refuse("method-disabled");

  const tokenHash = hashToken(token);
  const row = await ctx.store.findToken("EMAIL_VERIFICATION", tokenHash);
  if (!row || row.consumedAt || isTokenExpired(row.expiresAt, ctx.now())) {
    return refuse("token-invalid");
  }
  // The conditional write is the single-use guarantee; the read above is only
  // an early exit. Two clicks race here and exactly one wins.
  const consumed = await ctx.store.consumeToken("EMAIL_VERIFICATION", tokenHash, ctx.now());
  if (!consumed) return refuse("token-invalid");

  await ctx.store.markEmailVerified(row.userId, ctx.now());
  return { ok: true };
}

/**
 * Send the verification link again.
 *
 * Always acknowledges, for the same reason sign-up does. A send actually
 * happens only for an account that exists, has a password and is still
 * unverified — an already-verified account gets nothing, so this cannot be used
 * to mail somebody repeatedly.
 */
export async function resendVerification(
  ctx: EmailCredentialsContext,
  rawEmail: string,
): Promise<AcknowledgeResult> {
  const email = normalizeEmail(rawEmail);
  const blocked = await guardEntry(ctx, email, `resend:${email}`);
  if (blocked) return blocked;

  const user = await ctx.store.findByEmail(email);
  if (!user || !user.passwordHash || user.emailVerifiedAt) return { ok: true };

  const issued = await issueLink(ctx, user.id, "EMAIL_VERIFICATION");
  await ctx.mailer.sendVerification({
    to: user.email,
    name: user.name,
    link: issued.link,
    token: issued.token,
    expiresAt: issued.expiresAt,
  });
  return { ok: true };
}
