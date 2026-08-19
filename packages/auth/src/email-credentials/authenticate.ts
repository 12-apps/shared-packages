import { dummyVerify, hashPassword, needsRehash, verifyPassword } from "../password";
import {
  guardEntry,
  normalizeEmail,
  refuse,
  type EmailCredentialsContext,
} from "./context";
import type { AuthenticateResult } from "./types";

/**
 * Checking an e-mail and a password — the one operation an attacker calls
 * millions of times, so the one where every branch has to be examined for what
 * it says by how long it took.
 *
 * There are three ways to fail before the password is even wrong: no such
 * address, an address that has never had a password (a Google-only account),
 * and a password that does not match. All three must be indistinguishable, in
 * both the answer and the time taken — which is why the first two burn a real
 * scrypt derivation on nothing before returning. Skipping that work is the
 * intuitive optimisation and it is precisely the bug: it turns response time
 * into a directory of who has an account here.
 *
 * The fourth failure, `email-not-verified`, is deliberately DISTINGUISHABLE. It
 * has to be — the person needs to be told to check their inbox — and it only
 * ever follows a correct password, so it reveals nothing to anyone who did not
 * already have the credentials.
 */

export interface AuthenticateInput {
  email: string;
  password: string;
}

/**
 * Re-hash a verified password whose stored parameters are behind the current
 * cost. Best-effort: a failure here must never turn a correct sign-in into a
 * failed one, so it is swallowed rather than propagated.
 */
async function upgradeHash(
  ctx: EmailCredentialsContext,
  userId: string,
  password: string,
): Promise<void> {
  try {
    await ctx.store.setPasswordHash(userId, await hashPassword(password));
  } catch {
    // The sign-in already succeeded; the next one will try the upgrade again.
  }
}

/** Verify credentials. The result's `user` is what a session is minted from. */
export async function authenticate(
  ctx: EmailCredentialsContext,
  input: AuthenticateInput,
): Promise<AuthenticateResult> {
  const email = normalizeEmail(input.email);
  const blocked = await guardEntry(ctx, email, `signin:${email}`);
  if (blocked) return blocked;

  const user = await ctx.store.findByEmail(email);
  if (!user?.passwordHash) {
    await dummyVerify();
    return refuse("invalid-credentials");
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    return refuse("invalid-credentials");
  }

  const { requireEmailVerification } = await ctx.readSettings();
  if (requireEmailVerification && !user.emailVerifiedAt) {
    return refuse("email-not-verified");
  }

  // The one moment the plaintext is legitimately in hand — see `needsRehash`.
  if (needsRehash(user.passwordHash)) await upgradeHash(ctx, user.id, input.password);

  return { ok: true, user };
}
