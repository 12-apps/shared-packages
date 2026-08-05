import type { MerchantRef, ResolvedCredentials } from '../core/types';
import type { ActivationContext } from './context';
import { failureFor, type VerifyChargeResult } from './failure';
import {
  verificationAmountCents,
  verificationAttemptId,
  verificationReference,
} from './reference';

/**
 * Prove a merchant can actually take money, by taking a cent (FUT-463).
 *
 * "Connected" and "can charge" are different facts, and the gap between them
 * is where a store silently fails: PagBank Connect completed, the card read
 * `Conectado`, the owner switched the provider on — and the first real shopper
 * hit `403 ACCESS_DENIED` at checkout, because the integration had never been
 * homologated. Nothing in the settings screen could have told them.
 *
 * So activation is earned rather than asserted: a REAL R$0,01 charge, through
 * the merchant's OWN connection, refunded immediately. It exercises the exact
 * path a shopper takes — same credentials, same account, same acquirer — so
 * whatever would break for a buyer breaks here instead, in front of the person
 * who can fix it.
 */

export interface VerifyChargeInput {
  /** One-time encrypted card blob minted client-side. No PAN reaches us. */
  token: string;
  /** PagBank requires the holder's CPF on a card charge. Never stored. */
  taxId: string;
  holderName: string;
  email: string;
}

/**
 * Read the merchant's credentials WITHOUT the enabled gate.
 *
 * `credentials.getCredentials` throws for a configured-but-disabled provider,
 * which is right for charging a shopper and exactly wrong here: verification
 * runs BEFORE activation, on a provider that is by definition still off. The
 * alternative — enable it, charge, disable on failure — would open a window in
 * which checkout could route a real buyer to a provider we have not proven.
 */
export async function credentialsForVerification(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
): Promise<ResolvedCredentials | null> {
  const stored = await ctx.config.get(merchant, provider);
  if (!stored) return null;
  const environment = stored.environment;
  const fields = { ...(stored.environments[environment] ?? {}) };
  // Same stamping the charge path gets via `withMerchantWebhookUrl`. This
  // bypasses the credential store to skip the enabled gate, so it would
  // otherwise skip the webhook URL with it — and a verification that announced
  // no destination would not be exercising the shopper's path.
  if (!fields['notificationUrl'] && ctx.webhookUrl) {
    const url = await ctx.webhookUrl(merchant, provider);
    if (url) fields['notificationUrl'] = url;
  }
  return {
    environment,
    fields,
    // Never let a stub flag fake a PRODUCTION verification: a fake pass here
    // would activate a merchant that cannot charge, which is the whole failure
    // this exists to prevent.
    stub: stored.stub === true && environment === 'SANDBOX',
  };
}

/**
 * The card-encryption public key the verification form must encrypt with —
 * the same key a shopper's browser gets, resolved the same way.
 *
 * It cannot come from a checkout-path resolver: that reads the merchant's
 * credentials through the enabled gate, and a merchant being verified is by
 * definition not enabled yet, so it would silently answer with a platform
 * fallback key (dev) or null (prod). Encrypting with another account's key
 * makes PagBank reject the charge — a verification failure with a cause nobody
 * could diagnose from the screen.
 *
 * Each adapter names its browser key differently — PagBank and Stone call it
 * `publicKey`, Stripe `publishableKey` — so whichever this connection stores
 * is read first. When none is stored the host's `mintCardPublicKey` hook may
 * fetch one with the merchant's OWN credentials (the PagBank lazy backfill —
 * an OAuth-connected store never pastes a key, and the connect flow does not
 * copy one in: the platform's own key belongs to a different account).
 */
export async function verificationCardPublicKey(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
): Promise<string | null> {
  const credentials = await credentialsForVerification(ctx, merchant, provider);
  if (!credentials) return null;

  const stored = credentials.fields['publicKey'] ?? credentials.fields['publishableKey'];
  if (stored) return stored;

  if (!ctx.mintCardPublicKey) return null;
  return ctx.mintCardPublicKey(merchant, provider, credentials);
}

/**
 * Charge a cent through the merchant's own connection and give it straight
 * back.
 *
 * Returns `ok: false` with the provider's reason rather than throwing: a
 * failed verification is an ANSWER, not an error — it is the screen telling
 * the owner what is still wrong.
 */
export async function verifyProviderCharge(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
  input: VerifyChargeInput,
): Promise<VerifyChargeResult> {
  // Throws UnknownProviderError for a name outside the registry — the host
  // contract at the move (`providers.get` throws). `ok: false` is reserved for
  // answers about a REAL provider; an unknown name is a caller bug, not one.
  const adapter = ctx.providers.get(provider);

  const credentials = await credentialsForVerification(ctx, merchant, provider);
  if (!credentials) return { ok: false, reason: 'Conecte a conta antes de verificar a cobrança.' };

  // A FRESH reference per attempt (FUT-679): the adapters fall back to the
  // reference as the provider idempotency key, and PagBank dedupes on it — a
  // constant one replayed the FIRST attempt's decline onto every retry. The
  // `--attempt` suffix is the redirect flow's own mechanism, already stripped
  // by `ownsVerificationReference` / `parseVerificationReference` everywhere.
  const reference = verificationReference(provider, merchant.id, verificationAttemptId());

  let snapshot;
  try {
    snapshot = await adapter.createCharge(
      {
        reference,
        amount: { amountCents: verificationAmountCents(ctx.providers, provider), currency: 'BRL' },
        method: 'CARD',
        customer: { name: input.holderName, email: input.email, taxId: input.taxId },
        card: { token: input.token },
        metadata: { purpose: 'activation-verification' },
      },
      credentials,
    );
  } catch (error) {
    return { ok: false, ...failureFor(error) };
  }

  if (snapshot.status !== 'PAID' && snapshot.status !== 'AUTHORIZED') {
    return {
      ok: false,
      reason: snapshot.declineReason
        ? `A cobrança de teste foi recusada (${snapshot.declineReason}).`
        : `A cobrança de teste não foi aprovada (${snapshot.status}).`,
    };
  }

  // Give the cent back. A failed refund must NOT fail the verification — the
  // merchant demonstrably charges, which is what was being proven — so it is
  // reported instead, and the owner sees a cent they can reconcile.
  let refunded = false;
  try {
    if (adapter.refund) {
      await adapter.refund(
        { providerChargeId: snapshot.providerChargeId, reason: 'verification' },
        credentials,
      );
      refunded = true;
    }
  } catch {
    refunded = false;
  }

  return { ok: true, refunded };
}
