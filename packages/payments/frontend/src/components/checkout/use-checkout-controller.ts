import { useCallback, useMemo, useState } from "react";

import type { CheckoutBasketIdentity } from "./basket";
import {
  resumeSurface,
  useCheckoutNav,
  useCreateFailure,
  useGoToPayment,
  useResumedCheckout,
  useRetryAction,
  useSettledPort,
  useStartPayment,
  type Step,
} from "./checkout-actions";
import { useCheckoutCopy } from "./copy-context";

import { forgetHostedOrder } from "./hosted-return";
import { useCheckoutNavigate } from "./navigate-context";
import type { CheckoutDecline } from "./decline";
import type {
  BuyerContact,
  BuyerInfo,
  CheckoutOrder,
  CreateOrderRequest,
  CheckoutCustomerField,
  CreateOrderResult,
  OrderStatus,
  PaymentMethod,
} from "./types";
import { useHostedResume } from "./use-hosted-resume";

const STEP_ORDER: Step[] = ["dados", "payment", "status"];

/** The pre-FUT-595 demand, and the safe reading of a chain that declared none. */
const CPF_ONLY: readonly CheckoutCustomerField[] = [
  { key: "taxId", type: "CPF", required: true },
];

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
   * Persist the buyer's contact when they press "Continuar" on Dados — the
   * host's account surface owns the write (and the blank-CPF-never-clears
   * rule). Fire-and-forget by contract: the flow advances regardless of the
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
 * - `back` is step-aware: Pagamento → Dados, else to the menu. With a CPF on
 *   file the flow never has a Dados step, so Pagamento goes back to the menu.
 * - `goToPayment` gates on the CPF (required for every charge) and PERSISTS the
 *   buyer's contact — through the host port — before advancing; nothing
 *   downstream of this step is allowed to be a precondition for their details
 *   being saved.
 * - `startPayment` raises the order (PIX → QR, CARD → chargeable); `payWithEmail`
 *   re-raises with a corrected e-mail for the merchant-email rejection.
 * - `retry` re-charges the SAME order when the refusal says another instrument
 *   could work (FUT-1145), and raises a fresh one when it does not.
 *
 * @param taxIdOnFile The buyer already has a CPF saved (FUT-465) ⇒ the Dados
 *   step has nothing left to ask, so checkout opens on Pagamento and `back`
 *   goes to the menu rather than to a form the buyer never saw. The CPF itself
 *   is never in the client's hands — the server reads it from the encrypted
 *   profile when the charge is raised.
 * @param buyerFields What the store's chain declares it needs from the buyer
 *   (FUT-595). Absent ⇒ CPF-required, which is what this gate demanded before
 *   there was a declaration to read — never "ask nothing".
 * @param basket WHICH basket this checkout is for (FUT-1213). Absent ⇒ the
 *   pre-1213 behaviour: a parked payment resumes on whatever checkout mounts
 *   next. See `./basket.ts` for why it is a signature of the lines.
 */
export function useCheckoutController(
  ports: CheckoutHostPorts,
  defaultBuyer?: BuyerInfo,
  taxIdOnFile = false,
  buyerFields: readonly CheckoutCustomerField[] = CPF_ONLY,
  tenantSlug?: string,
  basket?: CheckoutBasketIdentity,
) {
  const { createOrder, saveBuyerContact, onExitToMenu, onPaid } = ports;
  const validation = useCheckoutCopy().screens.validation;
  const navigate = useCheckoutNavigate();
  const resume = useHostedResume(tenantSlug, basket);
  const [step, setStep] = useState<Step>(taxIdOnFile ? "payment" : "dados");
  // No method pre-selected: the Pagamento step shows just the picker until the
  // buyer chooses PIX or card, then that method's order is raised and its UI
  // revealed. Avoids raising a throwaway PIX charge for a buyer who wants card.
  const [method, setMethodState] = useState<PaymentMethod | null>(null);
  const [buyer, setBuyerState] = useState<BuyerInfo>(defaultBuyer ?? {});
  const [saveProfile, setSaveProfile] = useState(true);
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [finalStatus, setFinalStatus] = useState<OrderStatus | null>(null);
  const [decline, setDecline] = useState<CheckoutDecline | null>(null);
  const [freshInstrument, setFreshInstrument] = useState(false);
  const [creating, setCreating] = useState(false);
  const failure = useCreateFailure();
  useResumedCheckout(resume, setOrder, setStep, setFinalStatus, setMethodState);

  const clearError = failure.clear;
  const setBuyer = useCallback((next: BuyerInfo) => { setBuyerState(next); clearError(); }, [clearError]);
  const { back, editBuyer } = useCheckoutNav(taxIdOnFile, onExitToMenu, setStep);
  const setMethod = useCallback((next: PaymentMethod) => {
    setMethodState((prev) => {
      // SCOPED (FUT-1240): the order dropped here is THIS store's, and so is
      // the parked entry that goes with it. Unscoped, changing method at store
      // B threw away store A's parked hand-off — the same cross-store slot the
      // slug closed on the read side, still open on the write side.
      if (prev !== next) { setOrder(null); forgetHostedOrder(tenantSlug); clearError(); }
      return next;
    });
  }, [clearError, tenantSlug]);
  const goToPayment = useGoToPayment({
    buyer, buyerFields, taxIdOnFile, saveProfile, saveBuyerContact, validation, failure, setStep,
  });
  const startPayment = useStartPayment({
    buyer, saveProfile, createOrder, navigate, tenantSlug, basket, failure,
    setCreating, setDecline, setOrder, setFinalStatus,
  });
  const payWithEmail = useCallback((email: string) => {
    if (!method) return;
    const next = { ...buyer, email };
    setBuyerState(next);
    void startPayment(method, next);
  }, [buyer, method, startPayment]);
  const handleResolved = useCallback((s: OrderStatus, refusal?: CheckoutDecline | null) => {
    setDecline(refusal ?? null);
    setFinalStatus(s);
    setStep("status");
  }, []);
  const retry = useRetryAction({
    decline, order, clearError, setOrder, setDecline, setFinalStatus, setStep, setFreshInstrument,
  });
  const completed = useMemo(() => new Set(STEP_ORDER.slice(0, STEP_ORDER.indexOf(step))), [step]);
  useSettledPort(finalStatus ?? resume.status, onPaid);

  return {
    step, setStep, method, setMethod, buyer, setBuyer, saveProfile, setSaveProfile,
    order, finalStatus: finalStatus ?? resume.status, creating,
    decline, freshInstrument,
    ...resumeSurface(resume),
    createError: failure.message, errorField: failure.field, errorCode: failure.code,
    goToMenu: onExitToMenu, back, editBuyer,
    goToPayment, startPayment, payWithEmail, handleResolved, retry, completed,
  };
}
