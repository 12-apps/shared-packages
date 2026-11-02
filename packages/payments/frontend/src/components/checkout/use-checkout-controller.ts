import { useCallback, useState } from "react";

import type { CheckoutBasketIdentity } from "./basket";
import {
  resumeSurface,
  useCreateFailure,
  useDropOrder,
  useResumedCheckout,
  useRetryAction,
  useSettledPort,
  type Step,
} from "./checkout-actions";
import { useOrderRefresh } from "./cart-changed";
import { useRaisedOrderRoute, useStartPayment } from "./start-payment";
import { useConfirmationWait } from "./confirmation-wait";

import { useForgetHostedOrder } from "./hosted-parking";
import { useCheckoutNavigate } from "./navigate-context";
import type { CheckoutDecline } from "./decline";
import type {
  BuyerContact,
  BuyerInfo,
  CheckoutOrder,
  CreateOrderRequest,
  CreateOrderResult,
  OrderStatus,
  PaymentMethod,
} from "./types";
import { useResolutionActions } from "./resolution-actions";
import { useHostedResume } from "./use-hosted-resume";

/**
 * Everything the flow needs FROM its host, as explicit ports (FUT-564). The
 * package owns the payment surface; the host owns the cart, the catalog,
 * order creation and its own routing — these callbacks are the entire seam
 * between the two, which is what lets the package import nothing from any app.
 */
export interface CheckoutHostPorts {
  /**
   * Raise the order (and its first charge). The host closes over everything
   * the flow must not know: WHICH cart, WHICH tenant, WHICH settlement scope.
 */
  createOrder: (input: CreateOrderRequest) => Promise<CreateOrderResult>;
  /**
   * Persist the buyer's contact when an order is raised under the "salvar
   * meus dados" consent — the host's account surface owns the write (and the
   * blank-CPF-never-clears rule). Fire-and-forget by contract: the flow advances regardless of the
   * outcome, and only calls this under the "salvar meus dados" consent.
 */
  saveBuyerContact?: (contact: BuyerContact) => void;
  /** Leave checkout for the host's menu/catalog. */
  onExitToMenu: () => void;
  /**
   * The order settled PAID. The storefront re-reads its cart here — the
   * server emptied it inside the confirmation transaction (FUT-601) and
   * nothing else tells the SPA. Never fired for FAILED/EXPIRED: that shopper
   * still has a basket to retry with.
 */
  onPaid?: () => void;
}

/**
 * All checkout state + handlers, so the checkout flow stays presentational.
 * - `setMethod` drops any order raised for the previous method (no stale QR/form).
 * - `startPayment` raises the order (PIX → QR, CARD → chargeable); `payWithEmail`
 *   re-raises with a corrected e-mail for the merchant-email rejection.
 * - `retry` re-charges the SAME order when the refusal says another instrument
 *   could work (FUT-1145), and raises a fresh one when it does not.
 *
 * @param basket WHICH basket this checkout is for (FUT-1213). Absent ⇒ the
 *   pre-1213 behaviour: a parked payment resumes on whatever checkout mounts
 *   next. See `./basket.ts` for why it is a signature of the lines.
 */
export function useCheckoutController(
  ports: CheckoutHostPorts,
  defaultBuyer?: BuyerInfo,
  tenantSlug?: string,
  basket?: CheckoutBasketIdentity,
) {
  const { createOrder, onExitToMenu, onPaid } = ports;
  const navigate = useCheckoutNavigate();
  const resume = useHostedResume(tenantSlug, basket);
  // Pagamento is the first step (FUT-4028): the list asks a missing CPF at its top.
  const [step, setStep] = useState<Step>("payment");
  // No method pre-selected: nothing is raised until the buyer presses the
  // list's bar, so no throwaway PIX charge for a buyer who wants card.
  const [method, setMethodState] = useState<PaymentMethod | null>(null);
  const [buyer, setBuyerState] = useState<BuyerInfo>(defaultBuyer ?? {});
  const [saveProfile, setSaveProfile] = useState(true);
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [finalStatus, setFinalStatus] = useState<OrderStatus | null>(null);
  const [decline, setDecline] = useState<CheckoutDecline | null>(null);
  const [freshInstrument, setFreshInstrument] = useState(false);
  const [creating, setCreating] = useState(false);
  const forgetHostedOrder = useForgetHostedOrder();
  const failure = useCreateFailure();
  useResumedCheckout(resume, setOrder, setStep, setFinalStatus, setMethodState);

  const clearError = failure.clear;
  const setBuyer = useCallback((next: BuyerInfo) => { setBuyerState(next); clearError(); }, [clearError]);
  const setMethod = useCallback((next: PaymentMethod) => {
    setMethodState((prev) => {
      // SCOPED (FUT-1240): the order dropped here is THIS store's, and so is
      // the parked entry that goes with it. Unscoped, changing method at store
      // B threw away store A's parked hand-off — the same cross-store slot the
      // slug closed on the read side, still open on the write side.
      if (prev !== next) { setOrder(null); forgetHostedOrder(tenantSlug); clearError(); }
      return next;
    });
  }, [clearError, tenantSlug, forgetHostedOrder]);
  const dropOrder = useDropOrder(setOrder, tenantSlug, clearError);
  const startPayment = useStartPayment({
    buyer, saveProfile, createOrder, navigate, tenantSlug, basket, failure,
    setCreating, setDecline, setOrder, setFinalStatus, setStep,
  });
  const { payWithEmail, handleResolved } = useResolutionActions({
    buyer, method, startPayment, setBuyerState, setDecline, setFinalStatus, setStep,
  });
  // Re-price the order in place when the cart moved under it (FUT-1139), routed as a raise is.
  const route = useRaisedOrderRoute({ navigate, tenantSlug, basket, setOrder, setFinalStatus, setStep });
  const refresh = useOrderRefresh({ order, buyer, saveProfile, createOrder, route });
  const retry = useRetryAction({
    decline, order, clearError, setOrder, setDecline, setFinalStatus, setStep, setFreshInstrument,
  });
  const settled = finalStatus ?? resume.status;
  useSettledPort(settled, onPaid);
  // The confirmation screen's own wait (FUT-1170). Live only where nothing else
  // is polling and nothing has answered: a resumed leg brings its own wait, and
  // every method's screen polls for itself on the payment step.
  const confirming = useConfirmationWait({
    orderId: order?.orderId ?? null,
    active: step === "status" && settled === null && resume.order === null,
    onSettled: setFinalStatus,
  });

  return {
    step, setStep, method, setMethod, buyer, setBuyer, saveProfile, setSaveProfile,
    order, finalStatus: settled, creating,
    decline, freshInstrument,
    ...resumeSurface(resume, confirming),
    createError: failure.message, errorField: failure.field, errorCode: failure.code,
    goToMenu: onExitToMenu,
    startPayment, refresh, payWithEmail, handleResolved, retry, dropOrder,
  };
}
