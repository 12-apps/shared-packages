import type { ChargeSnapshot, PaymentMethodKind } from '../core/types';
import { NAME, type InfinitePayPaymentCheck } from './infinitepay-http';
import { capturedAmountCents } from './shared';

/** The delivery body InfinitePay POSTs when a payment is approved. */
export interface InfinitePayWebhookBody {
  order_nsu?: string;
  transaction_nsu?: string;
  slug?: string;
  invoice_slug?: string;
  amount?: number;
  paid?: boolean;
  receipt_url?: string;
  /** Which method settled it — the delivery's own answer, when it sends one. */
  capture_method?: string;
  installments?: number;
}

/**
 * Which method the buyer actually paid with.
 *
 * The hosted page offers card and PIX, so this cannot be assumed — recording
 * a card payment as PIX corrupts reporting and reconciliation downstream.
 * `capture_method` is InfinitePay's explicit answer and wins; an installment
 * count is the fallback tell, since PIX is never installmented. Only with
 * neither signal does PIX stand as the default.
 */
function methodOf(source: { capture_method?: string; installments?: number }): PaymentMethodKind {
  const captured = (source.capture_method ?? '').toLowerCase();
  if (captured.includes('credit') || captured.includes('card')) return 'CARD';
  if (captured.includes('pix')) return 'PIX';
  return (source.installments ?? 0) > 0 ? 'CARD' : 'PIX';
}

/**
 * Did `payment_check` say money actually moved?
 *
 * Exported so the PROBE can ask the same question `checkSnapshot` asks, rather
 * than re-deriving it from the snapshot's status — the two answer different
 * questions and must not be confused. This one is "does a payment EXIST"; the
 * status is "what is the order's state". `findChargeByReference` needs the
 * former and a `PENDING` status is not it.
 */
export function isPaidCheck(check: InfinitePayPaymentCheck): boolean {
  return check.success === true || check.paid === true;
}

/**
 * A confirmed payment_check → PAID; anything else stays PENDING.
 *
 * A PAID check with no `amount` is REFUSED rather than reported as 0 cents —
 * see {@link capturedAmountCents}. `fallback.amountCents` is therefore
 * deliberately optional: only a caller that already knows what was charged may
 * supply one, and no caller here does.
 *
 * NOTE the shape an UNPAID answer necessarily has, because it is what makes
 * this snapshot unfit for the failover probe: 0 cents (nothing was captured, so
 * nothing is reported), no `hostedCheckoutUrl` (`payment_check` never returns
 * one), and a `providerChargeId` that falls back to OUR OWN reference. Handing
 * that to a caller which reads `PENDING` as "money is live" persists a charge
 * row that no buyer can ever pay — see `findChargeByReference`.
 */
export function checkSnapshot(
  check: InfinitePayPaymentCheck,
  fallback: { reference: string; amountCents?: number; currency: string; slug?: string },
): ChargeSnapshot {
  const paid = isPaidCheck(check);
  // Keep whatever correlation this answer carried. It is the ONLY place a slug
  // ever originates — `POST /links` does not return one — so persisting it here
  // is what lets a later re-read (the buyer's poll, the reconciliation sweep, a
  // support retry) ask `payment_check` a question it can actually answer.
  const hints = {
    ...(check.transaction_nsu ? { transactionNsu: check.transaction_nsu } : {}),
    ...(fallback.slug ? { slug: fallback.slug } : {}),
  };
  return {
    provider: NAME,
    providerChargeId: check.order_nsu ?? fallback.reference,
    // `order_nsu` IS our reference — InfinitePay echoes it on every answer and
    // on the return redirect, which is what lets a confirmation name its order
    // without a database lookup.
    reference: check.order_nsu ?? fallback.reference,
    status: paid ? 'PAID' : 'PENDING',
    amount: {
      amountCents: capturedAmountCents(NAME, paid, check.amount, fallback.amountCents),
      currency: fallback.currency,
    },
    method: methodOf(check),
    ...(Object.keys(hints).length > 0 ? { settlementHints: hints } : {}),
    raw: check,
  };
}
