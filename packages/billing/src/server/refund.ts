import { randomUUID } from "node:crypto";

import {
  createRefundRetrier,
  CredentialsError,
  REFUND_CLAIM_TTL_MS,
  UnsupportedOperationError,
  type FirstAttemptResult,
  type RefundRetrier,
  type RefundSeriesKey,
  type RefundSeriesRow,
  type RefundSnapshot,
} from "@12-apps/payments-backend";

import {
  SUBSCRIPTION_REFUND_SUBJECT,
  type RefundablePayment,
  type RefundablePaymentStore,
  type RefundPendingReason,
  type RefundPendingRecord,
  type RefundRecord,
  type SettleByHandResult,
  type SubscriptionRefund,
  type SubscriptionRefundDeps,
  type SubscriptionRefundResult,
} from "./refund-ports";
import { confirmDue, markNotReturned, readCharge, refundUpdated, refundWebhookHandler } from "./refund-confirm";

/**
 * Subscription REFUND (FUT-4864) — returning one paid subscription payment to
 * the customer, through the provider that took it.
 *
 * ## The flow is the payments package's
 *
 * Every provider call is made by `@12-apps/payments-backend`'s refund retrier
 * (`createRefundRetrier`, FUT-4740), the one store refunds use: attempt 1 under
 * a deadline with `retriedByCaller`, a "not yet" or a lost answer opened as a
 * background series whose every later attempt is CLAIMED behind the series
 * row's version and CONSULTS the charge before it sends anything, a charge
 * with nothing left to refund adopted as returned with the amount the consult
 * saw, a person's retry as a new series that consults first, and a hand
 * settlement that waits while an attempt is in flight. Nothing here calls the
 * gateway's `refund` itself.
 *
 * What this module adds is the binding that flow needs and cannot invent: the
 * merchant (the PLATFORM's, the inversion collection rests on), what a
 * subscription payment's series is keyed by, the host's payment rows as the
 * claim that lets attempt 1 be sent ONCE, and the outcome a host reads.
 *
 * What stays in the HOST is every opinion: WHEN a payment is refundable (a
 * withdrawal window, from which payment it counts, whether a renewal reopens
 * it), what a cancel does to the plan, who may ask for a refund or settle one
 * by hand, and how that is audited.
 *
 * ## Two fences, so a refund is never sent twice
 *
 *  1. Attempt 1 is sent only by the caller whose `claim` moved the payment
 *     from PAID to REFUND_PENDING — a compare-and-set in the host's row. Two
 *     cancels, two tabs: one sends, the other answers `IN_PROGRESS`.
 *  2. Every later attempt (the sweep's, a person's `retry`) is the retrier's,
 *     claimed behind its series row's version, and consults the charge first.
 *     `retry` is refused while attempt 1 may still be running (its claim is
 *     younger than the retrier's claim lifetime and no answer was recorded).
 *
 * The host's two writes are conditional too: `markRefunded` only moves a row
 * that is still REFUND_PENDING, and `markRefundPending` only writes one that is
 * not refunded, so a late "pending" can never overwrite a refund.
 *
 * ## The channel
 *
 * A provider refund goes back by the channel the charge was paid through — a
 * Pix charge to the payer's key, a card charge to the card. Nothing here
 * chooses it: a refund is of a charge, not of an amount to a destination. The
 * payment's `method` is handed back so the host's copy can say which.
 *
 * ## A refund the provider is still processing
 *
 * A provider may answer a refund with a PENDING snapshot — accepted, to be
 * completed (common for Pix). It is recorded as refunded with
 * `confirmed: false`: the money is the provider's to return now, and a person
 * must not be asked to settle it. Confirming it (or a later failure) is the
 * provider's refund notification: the host hands `onWebhookEvent` to its
 * platform webhook delivery, and the sweep (`confirmDue`) reads the charge.
 *
 * Server-only.
 */

type SendingGateway = Awaited<ReturnType<SubscriptionRefundDeps["payments"]>>["gateway"];

/** One call's context: the deps, the clock and this request's stores. */
interface Ctx {
  deps: SubscriptionRefundDeps;
  now: () => Date;
  store: RefundablePaymentStore;
}

/** A provider's message, trimmed to what an operator can read in one line. */
function messageOf(error: unknown): string | null {
  if (!(error instanceof Error) || error.message.trim() === "") return null;
  return error.message.trim().slice(0, 500);
}

/** A refusal decided before anything was sent, in this package's words. */
function predispatchReason(error: unknown): RefundPendingReason {
  if (error instanceof UnsupportedOperationError) return "UNSUPPORTED";
  if (error instanceof CredentialsError) return "NO_CREDENTIALS";
  // Anything else the retrier did not classify: nothing is known, a person looks.
  return "UNKNOWN";
}

function snapshotRecord(snapshot: RefundSnapshot, at: Date): RefundRecord {
  return {
    how: "PROVIDER",
    providerRefundId: snapshot.providerRefundId || null,
    refundedCents: snapshot.amount?.amountCents ?? null,
    confirmed: snapshot.status === "REFUNDED",
    at,
  };
}

function keyOf(ctx: Ctx, payment: RefundablePayment, reason?: string): RefundSeriesKey {
  return {
    merchant: ctx.deps.merchant,
    provider: payment.provider ?? "",
    providerChargeId: payment.providerChargeId ?? "",
    reference: payment.id,
    subject: SUBSCRIPTION_REFUND_SUBJECT,
    // Bound to the refund REQUEST, by the id the host stores and returns
    // unchanged: a refund reopened after the provider said it failed is a new
    // request, so a new series. A request with no stored id (made before the
    // field existed) keeps the payment id, the binding its live series has.
    boundTo: payment.requestId ? `${payment.id}:${payment.requestId}` : payment.id,
    cause: reason ?? null,
  };
}

/**
 * The money a charge read sees back on a payment reopened NOT_RETURNED is the
 * refund said never returned — unless a second refund was sent since, when it
 * may be either: then no id is recorded, and that refund's late word is a
 * double return.
 */
function adoptedRefundId(payment: RefundablePayment | null): string | null {
  return payment?.notReturnedRefundId && !payment.sentAgain ? payment.notReturnedRefundId : null;
}

/** The gateway, telling the host before every refund it sends (`sendingAgain`). */
function recordingSends(gateway: SendingGateway, store: RefundablePaymentStore, now: () => Date): SendingGateway {
  return {
    refreshCharge: (...args) => gateway.refreshCharge(...args),
    refund: async (merchant, provider, input) => {
      await store.sendingAgain(provider, input.providerChargeId, now());
      return gateway.refund(merchant, provider, input);
    },
  };
}

/** The retrier over this request's stores, with the subscription host half bound. */
async function retrierOf(ctx: Ctx): Promise<RefundRetrier> {
  const { deps, store, now } = ctx;
  const [{ gateway }, series] = await Promise.all([deps.payments(), deps.series()]);
  return createRefundRetrier({
    gateway: recordingSends(gateway, store, now),
    store: series,
    now: deps.now,
    attemptMs: deps.attemptMs,
    onProviderFailure: deps.onProviderFailure,
    host: {
      // Still owed while the row is pending: a hand settlement or a refund recorded elsewhere ends the series.
      stillOwed: async (row: RefundSeriesRow) => (await store.find(row.reference))?.state === "REFUND_PENDING",
      attempted: async (row, refusal, error) => {
        await store.markRefundPending(row.reference, { reason: refusal, message: messageOf(error), at: now() });
      },
      refunded: async (row, outcome) => {
        const record: RefundRecord = outcome.snapshot
          ? snapshotRecord(outcome.snapshot, now())
          : {
              how: "ADOPTED",
              providerRefundId: adoptedRefundId(await store.find(row.reference)),
              refundedCents: outcome.refundedCents ?? null,
              confirmed: true,
              at: now(),
            };
        await store.markRefunded(row.reference, record);
      },
    },
  });
}

async function pending(ctx: Ctx, payment: RefundablePayment, record: RefundPendingRecord): Promise<SubscriptionRefundResult> {
  await ctx.store.markRefundPending(payment.id, record);
  return { outcome: "PENDING", paymentId: payment.id, method: payment.method, record };
}

/**
 * Record a refund attempt 1 took. When the write itself fails the money is
 * back and the row says otherwise: a series is opened due now, so the sweep
 * consults the charge, adopts the refund and writes it again.
 */
async function refunded(
  ctx: Ctx,
  retrier: RefundRetrier,
  payment: RefundablePayment,
  record: RefundRecord,
): Promise<SubscriptionRefundResult> {
  try {
    await ctx.store.markRefunded(payment.id, record);
  } catch (error) {
    await retrier.openDue(keyOf(ctx, payment)).catch(() => false);
    throw error;
  }
  return { outcome: "REFUNDED", paymentId: payment.id, method: payment.method, record };
}

/** Attempt 1's answer, on the payment row. */
function recordFirst(
  ctx: Ctx,
  retrier: RefundRetrier,
  payment: RefundablePayment,
  result: FirstAttemptResult,
): Promise<SubscriptionRefundResult> {
  const at = ctx.now();
  switch (result.kind) {
    case "REFUNDED":
      return result.snapshot.status === "FAILED"
        ? pending(ctx, payment, { reason: "REFUSED", message: null, at })
        : refunded(ctx, retrier, payment, snapshotRecord(result.snapshot, at));
    case "ADOPTED":
      return refunded(ctx, retrier, payment, {
        how: "ADOPTED",
        providerRefundId: null,
        refundedCents: result.refundedCents,
        confirmed: true,
        at,
      });
    default:
      // A refusal for good; or "not yet" / no answer, whose series the retrier opened (and
      // recorded through `attempted`) and the sweep carries on. Recorded here as well, in
      // case no series opened.
      return pending(ctx, payment, { reason: result.kind, message: messageOf(result.error), at });
  }
}

/** Attempt 1, sent by the claim's winner only. */
async function firstAttempt(ctx: Ctx, payment: RefundablePayment, reason: string | undefined): Promise<SubscriptionRefundResult> {
  if (!payment.provider || !payment.providerChargeId) {
    return pending(ctx, payment, { reason: "NO_CHARGE", message: null, at: ctx.now() });
  }
  const retrier = await retrierOf(ctx);
  let result: FirstAttemptResult;
  try {
    result = await retrier.firstAttempt(keyOf(ctx, payment, reason), reason ? { reason } : {});
  } catch (error) {
    return pending(ctx, payment, { reason: predispatchReason(error), message: messageOf(error), at: ctx.now() });
  }
  return recordFirst(ctx, retrier, payment, result);
}

/** Attempt 1 may still be running: claimed recently and nothing answered yet. */
function attemptOneMayRun(ctx: Ctx, payment: RefundablePayment): boolean {
  if (payment.pendingReason !== null || payment.requestedAt === null) return false;
  return ctx.now().getTime() < payment.requestedAt.getTime() + REFUND_CLAIM_TTL_MS;
}

type Refusal = { outcome: "NOT_REFUNDABLE"; paymentId: string; why: "NOT_FOUND" | "NOT_PAID" | "ALREADY_REFUNDED" | "IN_PROGRESS" };

/** The payment a person's act (retry, settle) may touch: pending, with attempt 1 over. */
async function pendingPayment(ctx: Ctx, paymentId: string): Promise<RefundablePayment | Refusal> {
  const payment = await ctx.store.find(paymentId);
  if (!payment) return { outcome: "NOT_REFUNDABLE", paymentId, why: "NOT_FOUND" };
  if (payment.state === "REFUNDED") return { outcome: "NOT_REFUNDABLE", paymentId, why: "ALREADY_REFUNDED" };
  if (payment.state !== "REFUND_PENDING") return { outcome: "NOT_REFUNDABLE", paymentId, why: "NOT_PAID" };
  if (attemptOneMayRun(ctx, payment)) return { outcome: "NOT_REFUNDABLE", paymentId, why: "IN_PROGRESS" };
  return payment;
}

const refused = (value: RefundablePayment | Refusal): value is Refusal => "outcome" in value;

async function refund(ctx: Ctx, paymentId: string, reason: string | undefined): Promise<SubscriptionRefundResult> {
  const payment = await ctx.store.find(paymentId);
  if (!payment) return { outcome: "NOT_REFUNDABLE", paymentId, why: "NOT_FOUND" };
  if (payment.state === "REFUNDED") return { outcome: "NOT_REFUNDABLE", paymentId, why: "ALREADY_REFUNDED" };
  if (payment.state === "REFUND_PENDING") return { outcome: "NOT_REFUNDABLE", paymentId, why: "IN_PROGRESS" };
  if (payment.state !== "PAID") return { outcome: "NOT_REFUNDABLE", paymentId, why: "NOT_PAID" };
  const at = ctx.now();
  const requestId = randomUUID();
  if (!(await ctx.store.claim(paymentId, at, requestId))) return { outcome: "NOT_REFUNDABLE", paymentId, why: "IN_PROGRESS" };
  return firstAttempt(ctx, { ...payment, state: "REFUND_PENDING", requestedAt: at, requestId }, reason);
}

/** The payment as it stands after the retrier ran, as an outcome. */
async function outcomeOf(ctx: Ctx, payment: RefundablePayment): Promise<SubscriptionRefundResult> {
  const after = await ctx.store.find(payment.id);
  const at = ctx.now();
  if (after?.state === "REFUNDED") {
    const record: RefundRecord = { how: "PROVIDER", providerRefundId: null, refundedCents: null, confirmed: true, at };
    return { outcome: "REFUNDED", paymentId: payment.id, method: payment.method, record };
  }
  const record: RefundPendingRecord = { reason: after?.pendingReason ?? "UNKNOWN", message: null, at };
  return { outcome: "PENDING", paymentId: payment.id, method: payment.method, record };
}

async function retry(ctx: Ctx, paymentId: string): Promise<SubscriptionRefundResult> {
  const payment = await pendingPayment(ctx, paymentId);
  if (refused(payment)) return payment;
  if (!payment.provider || !payment.providerChargeId) {
    return pending(ctx, payment, { reason: "NO_CHARGE", message: null, at: ctx.now() });
  }
  const retrier = await retrierOf(ctx);
  const key = keyOf(ctx, payment);
  // A series still running (an attempt due or in flight) answers a press without
  // sending anything: the sweep carries it on, so the person is told so.
  const running = retrier.viewOf(await retrier.find(key));
  if (running && (running.inFlight || !running.exhausted)) return { outcome: "NOT_REFUNDABLE", paymentId, why: "IN_PROGRESS" };
  try {
    await retrier.press(key);
  } catch (error) {
    return pending(ctx, payment, { reason: predispatchReason(error), message: messageOf(error), at: ctx.now() });
  }
  return outcomeOf(ctx, payment);
}

/**
 * A payment reopened NOT_RETURNED: the refund a person said never came back
 * may still land, so the charge is read before anything is settled by hand.
 * Money back → recorded returned (ADOPTED) and the settlement refused; an
 * unreadable charge refuses it too (settle later). Null: not back, go on.
 */
async function notReturnedYet(ctx: Ctx, payment: RefundablePayment): Promise<SettleByHandResult | null> {
  const read = await readCharge(ctx.deps, payment);
  if (read === "NOT_BACK") return null;
  if (read === "UNREADABLE") return { outcome: "NOT_REFUNDABLE", paymentId: payment.id, why: "CHARGE_UNREADABLE" };
  const record: RefundRecord = { how: "ADOPTED", providerRefundId: adoptedRefundId(payment), refundedCents: null, confirmed: true, at: ctx.now() };
  const wrote = await ctx.store.markRefunded(payment.id, record);
  return { outcome: "NOT_REFUNDABLE", paymentId: payment.id, why: wrote ? "MONEY_BACK" : "ALREADY_REFUNDED" };
}

async function settleByHand(
  ctx: Ctx,
  paymentId: string,
  byHand: { by: string; via: string; reason: string },
): Promise<SettleByHandResult> {
  const payment = await pendingPayment(ctx, paymentId);
  if (refused(payment)) return payment;
  if (payment.pendingReason === "NOT_RETURNED") {
    const notYet = await notReturnedYet(ctx, payment);
    if (notYet) return notYet;
  }
  const retrier = await retrierOf(ctx);
  const key = keyOf(ctx, payment);
  if (payment.provider && payment.providerChargeId && !(await retrier.settleByHand(key))) {
    return { outcome: "NOT_REFUNDABLE", paymentId, why: "IN_PROGRESS" };
  }
  const record: RefundRecord = { how: "BY_HAND", providerRefundId: null, refundedCents: null, confirmed: true, at: ctx.now(), byHand };
  let wrote: boolean;
  try {
    wrote = await ctx.store.markRefunded(paymentId, record);
  } catch (error) {
    // The series was settled for a write that did not hold: it reads pending again, nothing sent.
    await retrier.reopenByHand(key).catch(() => undefined);
    throw error;
  }
  if (!wrote) return { outcome: "NOT_REFUNDABLE", paymentId, why: "ALREADY_REFUNDED" };
  return { outcome: "REFUNDED", paymentId, record };
}

export function createSubscriptionRefund(deps: SubscriptionRefundDeps): SubscriptionRefund {
  const now = deps.now ?? (() => new Date());
  const ctx = async (): Promise<Ctx> => ({ deps, now, store: await deps.store() });
  return {
    refund: async (paymentId, options) => refund(await ctx(), paymentId, options?.reason),
    retry: async (paymentId) => retry(await ctx(), paymentId),
    settleByHand: async (paymentId, byHand) => settleByHand(await ctx(), paymentId, byHand),
    runDue: async (limit) => (await retrierOf(await ctx())).runDue(limit),
    confirmDue: (limit) => confirmDue(deps, limit),
    refundUpdated: (update) => refundUpdated(deps, update),
    onWebhookEvent: refundWebhookHandler(deps),
    markNotReturned: (paymentId, byHand) => markNotReturned(deps, paymentId, byHand),
  };
}
