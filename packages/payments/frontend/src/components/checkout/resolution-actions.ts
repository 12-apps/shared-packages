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
}): {
  payWithEmail: (email: string) => void;
  handleResolved: (status: OrderStatus, refusal?: CheckoutDecline | null) => void;
} {
  const { buyer, method, startPayment, setBuyerState, setDecline, setFinalStatus, setStep } = input;
  const payWithEmail = useCallback((email: string) => {
    if (!method) return;
    const next = { ...buyer, email };
    setBuyerState(next);
    void startPayment(method, next);
  }, [buyer, method, setBuyerState, startPayment]);
  const handleResolved = useCallback((status: OrderStatus, refusal?: CheckoutDecline | null) => {
    setDecline(refusal ?? null);
    setFinalStatus(status);
    setStep("status");
  }, [setDecline, setFinalStatus, setStep]);
  return { payWithEmail, handleResolved };
}
