import { stubResolvedFor } from '../core/stub-mode';
import { classifyFailure } from '../core/failover';
import type { PaymentProviderAdapter } from '../core/provider';
import type { MerchantRef, ResolvedCredentials } from '../core/types';
import {
  cardAttemptRecord,
  isCardAttemptRecord,
  probeLostCardAttempt,
  refundCent,
} from './card-attempt';
import type { ActivationContext } from './context';
import { failureFor, unreachableReason, type VerifyChargeResult } from './failure';
import {
  ownsVerificationReference,
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
    // Never let a stub flag fake a verification: a fake pass here would
    // activate a merchant that cannot charge, which is the whole failure this
    // exists to prevent. So the row's flag counts only on a deployment that
    // said yes to stub mode (`ctx.allowStubMode`, default off) and only for
    // SANDBOX — a stale row on a production deploy proves nothing.
    stub: stubResolvedFor(ctx.allowStubMode, stored.stub, environment),
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

/** Everything one card-phase attempt runs against, resolved once. */
interface CardPhase {
  ctx: ActivationContext;
  adapter: PaymentProviderAdapter;
  merchant: MerchantRef;
  provider: string;
  credentials: ResolvedCredentials;
}

/**
 * Charge a cent through the merchant's own connection and give it straight
 * back.
 *
 * Returns `ok: false` with the provider's reason rather than throwing: a
 * failed verification is an ANSWER, not an error — it is the screen telling
 * the owner what is still wrong.
 *
 * A LOST answer is neither (FUT-679). The attempt's intent is recorded before
 * the create (see `card-attempt.ts`), an earlier attempt still standing is
 * resolved through the provider BEFORE any new charge is minted — the fresh
 * per-attempt reference below means a retry is a new charge at the provider,
 * so an unaccounted-for earlier cent must be found first or the retry stacks
 * a second one on it — and an attempt that cannot be resolved right now
 * leaves its record for the settings-screen heal and the reconcile sweep.
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

  const phase: CardPhase = { ctx, adapter, merchant, provider, credentials };

  const earlier = await resolveEarlierAttempt(phase);
  if (earlier) return earlier;

  // A FRESH reference per attempt (FUT-679): the adapters fall back to the
  // reference as the provider idempotency key, and PagBank dedupes on it — a
  // constant one replayed the FIRST attempt's decline onto every retry. The
  // `--attempt` suffix is the redirect flow's own mechanism, already stripped
  // by `ownsVerificationReference` / `parseVerificationReference` everywhere.
  const reference = verificationReference(provider, merchant.id, verificationAttemptId());

  // Write-ahead intent, gated on the adapter declaring the probe that could
  // ever resolve it: recorded before the create, this row is what still
  // remembers the charge when the response is lost — the reconcile sweep only
  // scans configs holding a pending row, and a card charge leaves neither of
  // its durable proofs (no stored charge; PagBank's webhook `verify` proves
  // the sender, not the payment).
  if (adapter.findChargeByReference) {
    await ctx.settings.setPendingVerification(merchant, provider, cardAttemptRecord(reference));
  }

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
    return settleFailedCreate(phase, reference, error);
  }

  // The provider answered: the attempt is settled, whatever the answer was.
  await clearCardAttempt(phase);

  if (snapshot.status !== 'PAID' && snapshot.status !== 'AUTHORIZED') {
    return { ok: false, reason: notApprovedText(snapshot) };
  }

  // Give the cent back. A failed refund must NOT fail the verification — the
  // merchant demonstrably charges, which is what was being proven — so it is
  // reported instead, and the owner sees a cent they can reconcile.
  return { ok: true, refunded: await refundCent(adapter, snapshot.providerChargeId, credentials) };
}

/**
 * Settle the card attempt still outstanding, if one is.
 *
 * `null` lets a fresh attempt proceed: nothing is outstanding, or the
 * provider itself said the earlier reference holds no live charge. A result
 * is returned INSTEAD of charging again — either the earlier cent was found
 * (the proof it is: refunded and adopted as this call's pass), or the
 * question is still unanswerable, and minting a second real charge under an
 * unaccounted-for first one is exactly what this resolution exists to
 * prevent ("no máximo uma cobrança real existe").
 */
async function resolveEarlierAttempt(phase: CardPhase): Promise<VerifyChargeResult | null> {
  const { ctx, adapter, merchant, provider, credentials } = phase;
  // An adapter that cannot be probed never wrote a record (see the gate on
  // the write-ahead) — and a row it cannot resolve must not block retries.
  if (!adapter.findChargeByReference) return null;

  const pending = await ctx.settings.getPendingVerification(merchant, provider);
  if (!pending || !isCardAttemptRecord(pending)) return null;
  // Derivation check, as everywhere a stored reference is read (FUT-463): a
  // row naming another merchant's or provider's charge proves nothing here —
  // the fresh attempt simply overwrites it.
  if (!ownsVerificationReference(pending.reference, provider, merchant.id)) return null;

  const outcome = await probeLostCardAttempt(adapter, pending.reference, credentials);
  if (outcome.kind === 'PROVEN') return adoptProvenAttempt(phase, outcome);
  // DECLINED was the EARLIER attempt's own answer, arrived late — the owner
  // is retrying with another card, and replaying an old refusal onto it is
  // the exact bug the per-attempt reference kills. GONE is the provider's
  // word that no live charge exists. Neither kept any money: forget the row.
  if (outcome.kind === 'DECLINED' || outcome.kind === 'GONE') {
    await ctx.settings.setPendingVerification(merchant, provider, null);
    return null;
  }
  if (outcome.kind === 'OPEN') {
    return {
      ok: false,
      reason: 'A cobrança de teste anterior ainda está em processamento. Tente de novo em instantes.',
    };
  }
  return stillUnaccounted(adapter.displayName, outcome.error);
}

/**
 * The create THREW — decide what that means for the write-ahead record.
 *
 * `classifyFailure` is the gateway's own vocabulary for this exact call (see
 * `core/charge-attempt.ts`): only AMBIGUOUS means the provider may have
 * created the charge before failing. A refusal that provably created nothing
 * (4xx, a pre-send network error) and a thrown decline both SETTLE the
 * attempt — the record is cleared and the failure surfaces as before. An
 * AMBIGUOUS failure is resolved through the provider right here when it can
 * be; when it cannot, the record STAYS — it is the only thing that remembers
 * a cent whose answer was lost, and the sweep/heal cures it (FUT-679).
 */
async function settleFailedCreate(
  phase: CardPhase,
  reference: string,
  error: unknown,
): Promise<VerifyChargeResult> {
  const { adapter, credentials } = phase;
  const failure: VerifyChargeResult = { ok: false, ...failureFor(error) };
  if (!adapter.findChargeByReference) return failure;

  if (classifyFailure(error) !== 'AMBIGUOUS') {
    await clearCardAttempt(phase);
    return failure;
  }

  const outcome = await probeLostCardAttempt(adapter, reference, credentials);
  if (outcome.kind === 'PROVEN') return adoptProvenAttempt(phase, outcome);
  if (outcome.kind === 'DECLINED') {
    await clearCardAttempt(phase);
    return {
      ok: false,
      reason: notApprovedText({ status: 'DECLINED', declineReason: outcome.declineReason }),
    };
  }
  if (outcome.kind === 'GONE') {
    await clearCardAttempt(phase);
    return failure;
  }
  // OPEN or UNANSWERED: a real charge may exist, and only the record
  // remembers it. Leave it standing.
  return failure;
}

/**
 * The lost cent was FOUND: give it back (unless the provider already did),
 * clear the record, and answer the pass the charge itself proved. The caller
 * settles enablement from this result exactly as from a first-try pass.
 */
async function adoptProvenAttempt(
  phase: CardPhase,
  outcome: { providerChargeId: string; alreadyRefunded: boolean },
): Promise<VerifyChargeResult> {
  const { ctx, adapter, merchant, provider, credentials } = phase;
  const refunded =
    outcome.alreadyRefunded || (await refundCent(adapter, outcome.providerChargeId, credentials));
  await ctx.settings.setPendingVerification(merchant, provider, null);
  return { ok: true, refunded };
}

/** Clear the write-ahead record — the attempt's answer arrived. */
async function clearCardAttempt(phase: CardPhase): Promise<void> {
  if (!phase.adapter.findChargeByReference) return;
  await phase.ctx.settings.setPendingVerification(phase.merchant, phase.provider, null);
}

/** The screen's sentence for a charge the provider did not approve. */
function notApprovedText(snapshot: { status: string; declineReason?: string }): string {
  return snapshot.declineReason
    ? `A cobrança de teste foi recusada (${snapshot.declineReason}).`
    : `A cobrança de teste não foi aprovada (${snapshot.status}).`;
}

/**
 * The earlier cent is still unaccounted for and the provider unreachable —
 * nothing was created NOW, so the honest offer is the transport one: wait and
 * ask again. The record stays; the sweep is the fallback nobody has to click.
 */
function stillUnaccounted(displayName: string, error: unknown): VerifyChargeResult {
  const failure = failureFor(error);
  return {
    ok: false,
    ...failure,
    ...(failure.transport ? { reason: unreachableReason(displayName) } : {}),
  };
}
