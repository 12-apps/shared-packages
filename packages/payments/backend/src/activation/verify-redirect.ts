import type { PendingVerification } from '../config/types';
import type { ChargeInput, MerchantRef } from '../core/types';
import type { ActivationContext } from './context';
import type { ActivationCopy } from './copy';
import { failureFor, type PollFlags, type VerifyChargeResult } from './failure';
import {
  verificationAmountCents,
  verificationAttemptId,
  verificationReference,
} from './reference';
import { credentialsForVerification } from './verify-charge';

/**
 * The same proof, for a provider whose buyer pays on ITS page (FUT-463).
 *
 * InfinitePay takes no card here — it mints a checkout link and the payer
 * finishes on InfinitePay's own site — so the card form cannot be the test.
 * That is a difference of PROTOCOL, not of principle: a real R$0,01 still
 * moves, through this merchant's own connection, and `payment_check` still
 * says whether it arrived.
 *
 * Two phases, because a redirect payment is not synchronous: {@link
 * startRedirectVerification} mints the link, then {@link
 * pollRedirectVerification} asks the provider whether it was paid.
 */
export type RedirectStart =
  | { ok: true; checkoutUrl: string }
  | {
      ok: false;
      reason: string;
      providerMessage?: string;
      /**
       * We never reached the provider, so it refused NOTHING.
       *
       * Screens revoke the owner's "Checkout Integrado is on" claim when a
       * link is refused — the refusal being the strongest evidence available
       * that it is in fact off. A dropped connection is not that evidence, and
       * treating it as such sent an owner whose network blinked back through a
       * step they had already completed, to change a setting that was correct.
       */
      transport?: boolean;
    };

/**
 * The activation charge already outstanding for this connection, if any.
 *
 * Screens ask on every load, because the flow SENDS the owner away to pay —
 * "they came back" is the normal case. Held only in the browser, the attempt
 * died on that trip, and the screen then offered to generate another: a
 * second real charge on the owner's own card, with the first one paid and
 * forgotten.
 */
export async function getPendingVerification(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
): Promise<PendingVerification | null> {
  return ctx.settings.getPendingVerification(merchant, provider);
}

/** Give up on the outstanding charge, so the next attempt starts clean. */
export async function discardPendingVerification(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
): Promise<void> {
  await ctx.settings.setPendingVerification(merchant, provider, null);
}

/** Has a real charge through this connection ever succeeded? */
async function isChargeProven(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
): Promise<boolean> {
  const stored = await ctx.config.get(merchant, provider);
  return Boolean(stored?.chargeVerifiedAt);
}

export async function startRedirectVerification(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
  /**
   * The owner paying it. Sent so the provider's page arrives pre-filled
   * instead of asking them to re-type what we already know — the same
   * courtesy the shopper's checkout gets, on the flow whose whole point is
   * that it is the real one.
   */
  payer: { name?: string; email?: string } = {},
): Promise<RedirectStart> {
  // Throws UnknownProviderError for a name outside the registry — the same
  // contract the host code had at the move (`providers.get` throws), kept so
  // the move stays behaviour-preserving. A graceful `{ ok: false }` here would
  // silently change what the route answers for a hand-crafted provider name.
  const adapter = ctx.providers.get(provider);

  const credentials = await credentialsForVerification(ctx, merchant, provider);
  if (!credentials) return { ok: false, reason: ctx.copy.connectFirst };

  // Send the owner back to the screen they started from, not to a storefront
  // checkout. Beyond not abandoning them mid-activation, this is what makes
  // the charge confirmable: InfinitePay hangs `transaction_nsu` and `slug`
  // off the return URL, and `payment_check` refuses to answer without them.
  const returnUrl = await ctx.returnUrl?.(merchant, provider);
  if (returnUrl) credentials.fields['redirectUrl'] = returnUrl;

  const input = redirectChargeInput(ctx, merchant, provider, payer);

  let snapshot;
  try {
    snapshot = await adapter.createCharge(input, credentials);
  } catch (error) {
    return startFailure(ctx.copy, adapter.displayName, error);
  }

  if (!snapshot.hostedCheckoutUrl) {
    return { ok: false, reason: ctx.copy.noPaymentUrl };
  }

  await rememberAttempt(ctx, merchant, provider, snapshot, input.reference);
  return { ok: true, checkoutUrl: snapshot.hostedCheckoutUrl };
}

/**
 * The link's charge input, minted under a FRESH reference per attempt.
 * InfinitePay dedupes on `order_nsu`, so a constant one meant every retry was
 * handed the first link ever minted — frozen with the `redirect_url` it was
 * created with, which on a tunnel or a preview box is someone else's origin
 * entirely.
 */
function redirectChargeInput(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
  payer: { name?: string; email?: string },
): ChargeInput {
  return {
    reference: verificationReference(provider, merchant.id, verificationAttemptId()),
    amount: { amountCents: verificationAmountCents(ctx.providers, provider), currency: 'BRL' },
    // The hosted page offers card AND PIX; the buyer picks there. PIX is the
    // honest default for the intent — "any real payment proves it".
    method: 'PIX',
    customer: { name: payer.name ?? '', email: payer.email ?? '' },
    metadata: { purpose: 'activation-verification' },
  };
}

/** A refused (or unreachable) link, with the vendor named where we can. */
function startFailure(
  copy: Pick<ActivationCopy, 'platformApproval' | 'unreachable'>,
  displayName: string,
  error: unknown,
): RedirectStart {
  const failure = failureFor(error, copy);
  return {
    ok: false,
    ...failure,
    // Named here rather than in `failureFor`, which has no adapter and could
    // only ever say "o provedor".
    ...(failure.transport ? { reason: copy.unreachable(displayName) } : {}),
  };
}

/**
 * Record the attempt BEFORE the owner is sent to pay.
 *
 * `settlementHints.slug` is the provider's invoice code, and the response that
 * mints the link is the only place it can ever appear — dropped here,
 * `payment_check` can never confirm what was just created. It is frequently
 * absent for InfinitePay, whose live API answers with an opaque `?lenc=` link
 * carrying no code at all; the webhook is what supplies it then.
 */
async function rememberAttempt(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
  snapshot: { hostedCheckoutUrl?: string; settlementHints?: { slug?: string } },
  reference: string,
): Promise<void> {
  await ctx.settings.setPendingVerification(merchant, provider, {
    reference,
    checkoutUrl: snapshot.hostedCheckoutUrl ?? '',
    startedAt: new Date().toISOString(),
    ...(snapshot.settlementHints?.slug ? { slug: snapshot.settlementHints.slug } : {}),
  });
}

/**
 * What the charge remembered, plus what the return trip brought — the trip
 * wins. InfinitePay's `/links` never returns a slug at all (its live answer is
 * one opaque `?lenc=` URL), so in practice the redirect and the webhook are
 * the ONLY places both halves ever appear together.
 */
function mergedHints(
  storedSlug: string | undefined,
  returned: { transactionNsu?: string; slug?: string },
): { slug?: string; transactionNsu?: string } {
  return {
    ...(storedSlug ? { slug: storedSlug } : {}),
    ...(returned.transactionNsu ? { transactionNsu: returned.transactionNsu } : {}),
    ...(returned.slug ? { slug: returned.slug } : {}),
  };
}

/**
 * Has the cent actually arrived?
 *
 * Answered by asking the PROVIDER, never by trusting a webhook: InfinitePay's
 * deliveries are unsigned and its handle is public, so a forged notification
 * must not be able to activate a merchant. `findChargeByReference` is the
 * same re-query the order path uses before marking anything paid.
 *
 * `returned` is what the provider appended to the return URL when the owner
 * came back. BOTH halves matter, measured against InfinitePay's live API:
 * `handle + order_nsu + transaction_nsu + slug` → paid; the same call missing
 * EITHER answers `{"success":false}` — byte-identical to the answer for a
 * reference that was never created, so a partial question is not a weaker
 * one, it is indistinguishable from nonsense.
 */
export async function pollRedirectVerification(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
  returned: { transactionNsu?: string; slug?: string } = {},
): Promise<VerifyChargeResult & PollFlags> {
  // Throws UnknownProviderError for a name outside the registry, exactly as
  // the host code did at the move. The graceful answer below is only for a
  // REGISTERED adapter that cannot be polled (no `findChargeByReference`).
  const adapter = ctx.providers.get(provider);
  if (!adapter.findChargeByReference) {
    return { ok: false, reason: ctx.copy.unpollable(adapter.displayName) };
  }

  const credentials = await credentialsForVerification(ctx, merchant, provider);
  if (!credentials) return { ok: false, reason: ctx.copy.connectFirst };

  // The two halves of the correlation, from the two moments they exist: the
  // invoice code was kept when the link was minted, the transaction id
  // arrives only once someone has actually paid.
  const pending = await getPendingVerification(ctx, merchant, provider);

  // Already settled, by the webhook, while this tab was still asking. That is
  // the ordinary case rather than a race: the delivery carries the
  // `transaction_nsu` and `slug` `payment_check` insists on, so it confirms
  // first and clears the outstanding charge. Asking the provider again from
  // here would answer "not paid" — the same unanswerable question — and tell
  // an owner who HAS paid that they have not.
  if (!pending && (await isChargeProven(ctx, merchant, provider))) {
    // `alreadyProven` so the caller does NOT re-apply enablement: this poll
    // settled nothing. Re-applying would silently switch a proven provider
    // back ON for an owner who deliberately paused it — the exact stored
    // choice `chargeVerifiedAt` outliving `enabled` exists to protect.
    return { ok: true, refunded: false, alreadyProven: true };
  }

  const hints = mergedHints(pending?.slug, returned);

  let snapshot;
  try {
    snapshot = await adapter.findChargeByReference(
      polledReference(pending, provider, merchant.id),
      credentials,
      hints,
    );
  } catch (error) {
    // `pending: true`, deliberately: a poll that could not REACH the provider
    // has learned nothing about the charge. Settling it as failed cleared the
    // pending row — destroying the stored slug — and switched the provider
    // off, on the strength of a network blip. The next tick simply asks again.
    return { ok: false, pending: true, ...failureFor(error, ctx.copy) };
  }

  await keepReturnedSlug(ctx, merchant, provider, pending, returned.slug);
  return readPolledSnapshot(ctx.copy, snapshot);
}

/**
 * THE PENDING ATTEMPT'S OWN REFERENCE (FUT-684). `start` mints a fresh
 * `base--attempt` per try — the InfinitePay dedup fix — and asking the
 * provider about the bare base is asking about a payment that was never
 * created: `payment_check` answers the same `{"success":false}` it gives
 * nonsense, forever, so the browser could never confirm a paid charge and
 * every settlement silently depended on the webhook arriving. The base stays
 * as the fallback for a poll with no pending row (a reload racing the webhook
 * that just cleared it).
 */
function polledReference(
  pending: PendingVerification | null,
  provider: string,
  merchantId: string,
): string {
  return pending?.reference ?? verificationReference(provider, merchantId);
}

/**
 * A poll that arrived carrying the slug makes the STORED attempt confirmable
 * for every later ask — the timer's ticks, a reload, the sweep. The redirect
 * is the only moment the browser ever holds it; keep it.
 */
async function keepReturnedSlug(
  ctx: ActivationContext,
  merchant: MerchantRef,
  provider: string,
  pending: PendingVerification | null,
  slug: string | undefined,
): Promise<void> {
  if (!pending || pending.slug || !slug) return;
  await ctx.settings.setPendingVerification(merchant, provider, { ...pending, slug });
}

/**
 * Turn a polled snapshot into the screen's answer.
 *
 * The distinction that matters is OPEN vs SETTLED, not paid vs unpaid: an
 * open charge must keep the owner waiting, while any settled-and-negative
 * status has to switch the provider off rather than poll forever. Missing
 * counts as open — the owner simply has not paid yet.
 */
function readPolledSnapshot(
  copy: ActivationCopy,
  snapshot: { status: string; declineReason?: string } | null,
): VerifyChargeResult & PollFlags {
  const waiting = { ok: false as const, pending: true, reason: copy.awaitingPayment };
  if (!snapshot) return waiting;
  if (snapshot.status === 'PAID' || snapshot.status === 'AUTHORIZED') {
    // No refund attempt: InfinitePay refunds are made in InfinitePay's own
    // app, which its setup guide already tells the owner. Promising a
    // reversal we cannot perform would be another instruction that does not
    // work.
    return { ok: true, refunded: false };
  }
  if (snapshot.status === 'PENDING') return waiting;
  // The link's window elapsed with nobody paying it. Nothing is wrong with
  // the connection and nothing was charged — so the sentence must not read as
  // a failure, and the only useful offer is another link.
  if (snapshot.status === 'EXPIRED' || snapshot.status === 'CANCELED') {
    return { ok: false, outcome: 'expired', reason: copy.expired };
  }
  // A refused payment METHOD, which is a fact about the owner's card and not
  // about their store. The charge itself is untouched and still payable, so
  // it is kept (`retryable`) — the fix is another card, or Pix, on this link.
  if (snapshot.status === 'DECLINED') {
    return {
      ok: false,
      outcome: 'declined',
      retryable: true,
      reason: copy.instrumentDeclined,
    };
  }
  return {
    ok: false,
    outcome: 'refused',
    reason: snapshot.declineReason
      ? copy.chargeDeclined(snapshot.declineReason)
      : copy.chargeNotApproved(snapshot.status),
  };
}
