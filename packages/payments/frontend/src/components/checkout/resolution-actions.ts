import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { Step } from "./checkout-actions";
import type { CheckoutDecline } from "./decline";
import type { BuyerInfo, OrderStatus, PaymentMethod } from "./types";

/**
 * The two actions the payment step raises on its own: paying once an e-mail
 * has been typed, and reporting the result the provider's screen reached.
 *
 * Extracted from `useCheckoutController` for the same reason `useRetryAction`
 * and `useGoToPayment` were: the controller is the one function that has to
 * hold every piece of checkout state at once, and each action it also spells
 * out inline is a line it cannot spend on the state. FUT-1170 and FUT-1240
 * together pushed it past the size gate; these two callbacks are the part that
 * reads the same wherever it lives.
 */
export function useResolutionActions(input: {
  buyer: BuyerInfo;
  method: PaymentMethod | null;
  startPayment: (method: PaymentMethod, buyer: BuyerInfo) => Promise<void>;
  setBuyerState: Dispatch<SetStateAction<BuyerInfo>>;
  setDecline: Dispatch<SetStateAction<CheckoutDecline | null>>;
  setFinalStatus: Dispatch<SetStateAction<OrderStatus | null>>;
  setStep: Dispatch<SetStateAction<Step>>;
  setWaitElapsed: Dispatch<SetStateAction<boolean>>;
}): {
  payWithEmail: (email: string) => void;
  handleResolved: (status: OrderStatus, refusal?: CheckoutDecline | null) => void;
  handleWaitElapsed: () => void;
} {
  const { buyer, method, startPayment, setBuyerState, setDecline, setFinalStatus, setStep, setWaitElapsed } = input;
  const payWithEmail = useCallback((email: string) => {
    if (!method) return;
    const next = { ...buyer, email };
    setBuyerState(next);
    void startPayment(method, next);
  }, [buyer, method, setBuyerState, startPayment]);
  const handleResolved = useCallback((status: OrderStatus, refusal?: CheckoutDecline | null) => {
    setWaitElapsed(false);
    setDecline(refusal ?? null);
    setFinalStatus(status);
    setStep("status");
  }, [setDecline, setFinalStatus, setStep, setWaitElapsed]);
  // The card's own wait ran out with no answer (FUT-4401): the confirmation
  // screen says so — "não pague de novo", "você pode fechar esta tela" — with
  // its way back, and its own wait keeps listening for a late answer.
  const handleWaitElapsed = useCallback(() => {
    setWaitElapsed(true);
    setDecline(null);
    setFinalStatus(null);
    setStep("status");
  }, [setDecline, setFinalStatus, setStep, setWaitElapsed]);
  return { payWithEmail, handleResolved, handleWaitElapsed };
}

/**
 * The confirmation screen's wait facts, with the card pane's elapsed wait
 * folded in (FUT-4401): the screen opens on its "we stopped waiting" face
 * rather than on a second 90-second spinner, while the confirmation wait asks
 * quietly behind it. "Verificar de novo" puts the spinner back, as it always did.
 */
export function withElapsedWait<
  T extends { awaitingTimedOut: boolean; awaitingCheckAgain: () => void; resumeTimedOut: boolean; resumeCheckAgain: () => void },
>(surface: T, elapsed: boolean, setElapsed: Dispatch<SetStateAction<boolean>>): T {
  if (!elapsed) return surface;
  const checkAgain = (): void => {
    setElapsed(false);
    surface.awaitingCheckAgain();
  };
  // The deprecated spellings (`resumeSurface`) say the same, or an adopter
  // still reading them sees a spinner the screen no longer shows.
  return { ...surface, awaitingTimedOut: true, awaitingCheckAgain: checkAgain, resumeTimedOut: true, resumeCheckAgain: checkAgain };
}
