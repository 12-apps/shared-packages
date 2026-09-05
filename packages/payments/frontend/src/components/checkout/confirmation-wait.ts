import { useEffect } from "react";

import type { OrderStatus } from "./types";
import { usePaymentPolling } from "./use-payment-polling";

/**
 * THE CONFIRMATION STEP'S OWN WAIT (FUT-1170).
 *
 * Polling used to live entirely in the method's screen — the PIX code's footer,
 * the card pane's post-submit state — which is right for the payment step and
 * leaves the LAST step with none. A flow parked on Confirmação holding an
 * unsettled order therefore rendered "Confirmando seu pagamento" over a spinner
 * that stood for nothing: no poll was scheduled, no error could appear, no
 * clock could elapse, and the only control on screen was "Voltar ao cardápio".
 *
 * FUT-1170 reaches that state through the regenerate path, and dropping the
 * replaced charge closes that particular door. This is the other half, and it
 * is the half that holds for doors nobody has opened yet: any caller that lands
 * on the confirmation screen with a live order now has something asking about
 * it, and — when the clock runs out — something to press.
 *
 * ## Why here rather than hoisting the screens' polls into the flow
 *
 * The three waits are genuinely different. PIX is bounded by the CODE's own
 * expiry and decays over minutes; the card wait is 90 s from the submit; the
 * resumed hosted leg has its own release action attached to it. One hoisted
 * poll would have to serve all three at one cadence and one bound, and the
 * cadence is the thing each of them tunes. So the payment step keeps the wait
 * that belongs to the pane the buyer is looking at, and this covers the step
 * that has no pane of its own.
 *
 * The two can never run together: this one is gated on the confirmation step,
 * and every screen that polls renders on the payment step.
 */

/** How often the confirmation screen asks. The same cadence the panes open at. */
const CONFIRMATION_INTERVAL_MS = 2_500;

/**
 * How long it asks for, in WALL TIME — the card pane's bound, for the same
 * reason it has one: past this point the spinner is no longer a description of
 * anything, and the honest screen says so and offers the buyer the ask.
 *
 * Nothing is lost when it elapses. The order stays AWAITING server-side and is
 * still recoverable by webhook, reconciliation or backfill; what changes is
 * only that the screen stops pretending to watch.
 */
const CONFIRMATION_WAIT_MS = 90_000;

/** What the confirmation screen reads off a wait it owns. */
export interface ConfirmationWait {
  /** The bound elapsed — nothing further is scheduled. */
  timedOut: boolean;
  /** The last ask failed, and the wait is still running (FUT-1144). */
  error: string | null;
  /** Ask now, and start the clock over. */
  checkAgain: () => void;
}

/**
 * Watch the order the flow is holding, while the confirmation screen is the one
 * on display and nothing has settled it yet.
 *
 * @param active Whether this wait is the live one. FALSE for every checkout
 *   that has an answer already, and for every step that polls for itself — the
 *   caller decides, because only it knows which screen is up.
 * @param onSettled A terminal status arrived. Called once per status, with the
 *   status only: whether it carries a refusal is the charge path's knowledge and
 *   a poll has none of it.
 */
export function useConfirmationWait(input: {
  orderId: string | null;
  active: boolean;
  onSettled: (status: OrderStatus) => void;
}): ConfirmationWait {
  const { orderId, active, onSettled } = input;
  const { status, error, timedOut, checkAgain } = usePaymentPolling(orderId, {
    enabled: active,
    intervalMs: CONFIRMATION_INTERVAL_MS,
    maxWaitMs: CONFIRMATION_WAIT_MS,
  });

  useEffect(() => {
    if (!active || !status || status === "AWAITING_PAYMENT") return;
    onSettled(status);
  }, [active, status, onSettled]);

  // Reported only while this wait is the live one. A bound that elapsed for an
  // order the flow has since settled must not turn a paid confirmation into a
  // warning, and `usePaymentPolling` keeps its last answer after `enabled` goes
  // false — deliberately, so a settled wait can still be read.
  return {
    timedOut: active && timedOut,
    error: active ? error : null,
    checkAgain,
  };
}
