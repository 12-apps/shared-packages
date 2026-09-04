import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { CheckoutBasketIdentity } from "./basket";
import { useCheckoutClientApi } from "./client-context";
import {
  forgetHostedOrder,
  takeHostedOrder,
  type HostedResumeStep,
} from "./hosted-return";
import type { CheckoutOrder, OrderStatus } from "./types";
import { usePaymentPolling } from "./use-payment-polling";

/**
 * A LAYOUT effect where there is a DOM, an ordinary one where there is not.
 *
 * The resume decision cannot be made during render — it waits for the host's
 * cart to load — so it lands from an effect, and an ordinary effect runs AFTER
 * paint: a buyer coming back from a payment would see one frame of the Dados
 * or Pagamento step before their confirmation replaced it. A layout effect
 * commits before the browser paints, so the flow simply opens where it belongs.
 *
 * The branch is by ENVIRONMENT rather than by render pass, which is what makes
 * it a constant and not a conditional hook. It costs nothing on a server render
 * either: everything this hook decides from is `sessionStorage`, which does not
 * exist there — and `useLayoutEffect` on the server is a warning React prints
 * for exactly the case where the effect would matter and cannot run.
 */
export const useResumeEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The leg of checkout that RESUMES a payment this tab already raised (FUT-556,
 * FUT-1140, FUT-1213, FUT-1146).
 *
 * Three tickets share this hook because they are three halves of one mechanism,
 * and stacking them would have produced three: FUT-1213 decides WHETHER a
 * parked checkout may be resumed, FUT-1140 makes the parked entry cover every
 * raised order rather than only a hand-off, and FUT-1146 gives the buyer the
 * one way out that a hosted charge's own protocol cannot offer.
 *
 * ## How long it keeps asking, and how often
 *
 * TWO RATES, because one rate cannot serve this wait. The interval decides two
 * things that pull opposite ways: how fast a buyer WHO PAID is told so, and
 * what an abandoned checkout costs for the rest of the window. Every poll is a
 * provider round trip, so a slow rate is cheap and leaves a paying buyer
 * watching a spinner seconds longer than they need to — and the person on this
 * screen has almost always paid. A single number picks one of them to lose;
 * this shipped at a flat 5 s and picked the wrong one.
 *
 * So: 2.5 s for the first two minutes, which is where essentially every real
 * webhook lands, then 10 s for the remaining thirteen.
 *
 * Fifteen minutes because by then a webhook that was ever coming has come. The
 * BOUND is that wall-clock window, not a poll count (FUT-1144): a poll that
 * FAILS increments nothing, so a connection that never came back left this
 * screen asking with no end at all. A clock cannot be stopped by the failure it
 * is measuring.
 */
const HOSTED_RESUME_FAST_MS = 2_500;
const HOSTED_RESUME_SLOW_MS = 10_000;
/** Two minutes at the fast rate, before the wait is worth economising on. */
const HOSTED_RESUME_FAST_POLLS = (2 * 60_000) / HOSTED_RESUME_FAST_MS;
/** Thirteen more at the slow one — 15 minutes all told. */
const HOSTED_RESUME_WINDOW_MS = 15 * 60_000;

/**
 * How long the buyer waits before being offered a way out (FUT-1146).
 *
 * A cancelled or refused hosted payment has NO terminal state to arrive at.
 * The provider's `payment_check` publishes `success` and `paid` and nothing
 * else — no status, no cancel, no decline — the webhook verifier refuses an
 * unpaid delivery outright, and every server-side writer of FAILED is
 * unreachable from a hosted cancel. So the screen waits fifteen minutes and
 * then tells someone who never paid not to pay again. The only signal that
 * exists is the BUYER's, and this is how long we wait before asking for it.
 *
 * Thirty seconds: a webhook that was ever coming lands within seconds of the
 * payment (the fast rate above is sized on exactly that), so a wait still going
 * at thirty is already unusual — while a button offered instantly would sit
 * under a spinner during the two seconds in which most confirmations arrive,
 * inviting a shopper to abandon a payment that is landing. The release itself
 * is guarded server-side regardless: a payable the provider reports PAID is
 * answered PAID and released by nothing.
 */
const RELEASE_OFFER_AFTER_MS = 30_000;

/** What the resumed leg contributes to the controller's surface. */
export interface HostedResume {
  /** The rehydrated order, once the decision has been made. */
  order: CheckoutOrder | null;
  /** Where the flow should open for it — see `hosted-return.ts`. */
  step: HostedResumeStep | null;
  status: OrderStatus | null;
  timedOut: boolean;
  error: string | null;
  checkAgain: () => void;
  /**
   * The buyer's own "I did not pay" (FUT-1146), or `undefined` while it must
   * not be offered — nothing is being resumed, the wait has settled, or the
   * grace period above has not elapsed.
   */
  release: (() => void) | undefined;
  /** A release is in flight; the action must not be pressable twice. */
  releasing: boolean;
  /** The order was released — the caller opens a fresh checkout. */
  released: boolean;
}

/**
 * How long the decision waits for the host's cart before deciding without it.
 *
 * The deferral (FUT-1213) assumes the cart eventually answers. A cart FETCH can
 * fail — on exactly the flaky connection a buyer has coming back from their
 * bank app — and an unbounded wait there is the same shape of bug this ticket
 * is about, pointed the other way: the flow renders Dados forever and a paid
 * buyer's confirmation never lands.
 *
 * So the wait is bounded, and past the bound the decision is made WITHOUT a
 * basket, which is the pre-1213 answer: resume. That is the permissive
 * direction, deliberately, and it is the same one `hostedCheckoutReturnPending`
 * takes for an unloaded cart — a shopper whose cart never loaded cannot check
 * out with it either way, so the only outcome still worth protecting is the
 * confirmation of a payment that already happened.
 *
 * Eight seconds: long enough that no ordinary cart fetch reaches it, short
 * enough that a buyer coming back from a payment is not left looking at a form.
 */
const BASKET_WAIT_MS = 8_000;

/** The decision, made ONCE, as soon as the basket is loaded enough to make it. */
function useResumeDecision(
  tenantSlug: string | undefined,
  basket: CheckoutBasketIdentity | undefined,
): {
  resumed: { order: CheckoutOrder; step: HostedResumeStep } | null;
  setResumed: (next: { order: CheckoutOrder; step: HostedResumeStep } | null) => void;
  asking: CheckoutOrder | null;
  setAsking: (next: CheckoutOrder | null) => void;
} {
  const [resumed, setResumed] = useState<{ order: CheckoutOrder; step: HostedResumeStep } | null>(
    null,
  );
  const [asking, setAsking] = useState<CheckoutOrder | null>(null);
  // Once, whatever React does with this effect. The decision CONSUMES the
  // parked entry, so a second run would find nothing and un-resume a buyer
  // mid-confirmation — which is what StrictMode's double-invoke does for free.
  const decided = useRef(false);
  const waitedLongEnough = useBasketDeadline();

  useResumeEffect(() => {
    if (decided.current) return;
    // Past the deadline the basket is treated as unnamed rather than as
    // pending — see BASKET_WAIT_MS. A cart that never answered cannot be
    // compared with, and waiting forever is the worse of the two failures.
    const decision = takeHostedOrder(tenantSlug, waitedLongEnough ? undefined : basket);
    // WAIT is the host's cart still loading. Nothing was read and nothing was
    // consumed; the next render with a loaded basket decides for real.
    if (decision.verdict === "WAIT") return;
    decided.current = true;
    if (decision.verdict === "RESUME") setResumed({ order: decision.order, step: decision.step });
    if (decision.verdict === "ASK") setAsking(decision.order);
  }, [tenantSlug, basket, waitedLongEnough]);

  return { resumed, setResumed, asking, setAsking };
}

/**
 * Rule 3: a DIFFERENT basket stands, so ask the server once what the parked
 * order is worth.
 *
 * PAID resumes on the confirmation — that order is settled in the host's own
 * row by the webhook, and it is the one thing a shopper must never lose.
 * Anything else drops the entry and leaves the checkout to the basket in front
 * of them.
 *
 * A FAILED ASK leaves the entry parked, deliberately. "We could not reach the
 * server" is not "the order is not paid", and the shopper still gets their
 * normal checkout either way — so the cheap outcome is that a later mount asks
 * again and can still find the confirmation, rather than a dropped entry that
 * can never be recovered.
 */
function useAskBeforeResuming(
  asking: CheckoutOrder | null,
  onResume: (next: { order: CheckoutOrder; step: HostedResumeStep }) => void,
  onDrop: () => void,
): void {
  const client = useCheckoutClientApi();
  useEffect(() => {
    if (!asking) return undefined;
    let live = true;
    void client.getStatus(asking.orderId).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        onDrop();
        return;
      }
      forgetHostedOrder();
      if (answer.data === "PAID") onResume({ order: asking, step: "status" });
      else onDrop();
    });
    return () => {
      live = false;
    };
  }, [asking, client, onDrop, onResume]);
}

/** Whether the wait for the host's cart has run out — see {@link BASKET_WAIT_MS}. */
function useBasketDeadline(): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), BASKET_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  return elapsed;
}

/** Whether the "I did not pay" way out may be offered yet — see the constant. */
function useReleaseOffered(waiting: boolean): boolean {
  const [elapsed, setElapsed] = useState(false);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setTimeout(() => setElapsed(true), RELEASE_OFFER_AFTER_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return waiting && elapsed;
}

/** The release itself: ask the server to let the order go, unless it is paid. */
function useRelease(
  order: CheckoutOrder | null,
  onSettled: (status: OrderStatus) => void,
  onReleased: () => void,
): { run: () => void; releasing: boolean } {
  const client = useCheckoutClientApi();
  const [releasing, setReleasing] = useState(false);
  const run = useCallback(() => {
    if (!order || releasing) return;
    setReleasing(true);
    void client.releaseCheckout({ orderId: order.orderId }).then((answer) => {
      setReleasing(false);
      // The one answer that overrules the buyer: they say they did not pay and
      // the provider says they did. They keep their confirmation.
      if (answer.ok && answer.data === "PAID") {
        onSettled("PAID");
        return;
      }
      // Everything else — released, or a request that never got out — returns
      // them to a usable checkout. A server that could not be reached has not
      // taken their money either, and leaving them on a dead wait to be sure
      // is the failure this ticket exists to remove.
      forgetHostedOrder();
      onReleased();
    });
  }, [client, order, releasing, onSettled, onReleased]);
  return { run, releasing };
}

/** Still waiting on an answer for the order we resumed — nothing more. */
function stillWaiting(polling: boolean, released: boolean, settled: OrderStatus | null): boolean {
  if (!polling || released) return false;
  return settled === null || settled === "AWAITING_PAYMENT";
}

/** The wait's own poll, run for the CONFIRMATION leg and nothing else. */
function useResumePoll(
  order: CheckoutOrder | null,
  polling: boolean,
): { status: OrderStatus | null; timedOut: boolean; error: string | null; checkAgain: () => void } {
  // A resume that lands back on the payment step is handed to the PIX or card
  // pane, which runs its own wait — two polls for one order would race each
  // other to the same answer.
  return usePaymentPolling(order === null ? null : order.orderId, {
    enabled: polling,
    intervalMs: HOSTED_RESUME_FAST_MS,
    slowAfterPolls: HOSTED_RESUME_FAST_POLLS,
    slowIntervalMs: HOSTED_RESUME_SLOW_MS,
    maxWaitMs: HOSTED_RESUME_WINDOW_MS,
  });
}

export function useHostedResume(
  tenantSlug?: string,
  basket?: CheckoutBasketIdentity,
): HostedResume {
  const { resumed, setResumed, asking, setAsking } = useResumeDecision(tenantSlug, basket);
  const [override, setOverride] = useState<OrderStatus | null>(null);
  const [released, setReleased] = useState(false);

  const drop = useCallback(() => setAsking(null), [setAsking]);
  const resume = useCallback(
    (next: { order: CheckoutOrder; step: HostedResumeStep }) => {
      setAsking(null);
      setResumed(next);
    },
    [setAsking, setResumed],
  );
  useAskBeforeResuming(asking, resume, drop);

  const order = resumed === null ? null : resumed.order;
  const step = resumed === null ? null : resumed.step;
  const polling = step === "status";
  const wait = useResumePoll(order, polling);

  const settled = override === null ? wait.status : override;
  const offered = useReleaseOffered(stillWaiting(polling, released, settled));
  const onReleased = useCallback(() => {
    setResumed(null);
    setReleased(true);
  }, [setResumed]);
  const { run, releasing } = useRelease(order, setOverride, onReleased);

  return {
    order,
    step,
    // A RELEASED order reports nothing. The poll's last answer is still sitting
    // in its own state, and a controller that read it would carry "we are
    // confirming your payment" into the fresh checkout the buyer just asked for.
    status: released ? null : settled,
    timedOut: wait.timedOut,
    error: wait.error,
    checkAgain: wait.checkAgain,
    release: offered ? run : undefined,
    releasing,
    released,
  };
}
