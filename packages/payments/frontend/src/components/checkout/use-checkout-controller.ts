import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { buyerFormComplete } from "./buyer-info-form";

import { rememberHostedOrder, takeHostedOrder } from "./hosted-return";
import { useCheckoutNavigate, type CheckoutNavigate } from "./navigate-context";
import type {
  BuyerContact,
  BuyerField,
  BuyerInfo,
  CheckoutOrder,
  CreateOrderRequest,
  CheckoutCustomerField,
  CreateOrderResult,
  OrderStatus,
  PaymentMethod,
} from "./types";
import { usePaymentPolling } from "./use-payment-polling";

type Step = "dados" | "payment" | "status";

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
 * The flow's navigation actions, split out of {@link useCheckoutController} for
 * the 80-line per-function gate.
 *
 * `back` is where "the Dados step was skipped" has to be honoured: going back
 * off Pagamento normally lands on Dados, but for a buyer with a CPF on file
 * that step is not part of their flow, so the menu is the only honest
 * destination — until they open it themselves via `editBuyer` ("alterar" on the
 * payer block), after which it IS part of their flow and back returns to it.
 */
function useCheckoutNav(
  taxIdOnFile: boolean,
  goToMenu: () => void,
  setStep: Dispatch<SetStateAction<Step>>,
): { back: () => void; editBuyer: (() => void) | undefined } {
  const [dadosOpened, setDadosOpened] = useState(false);
  const openDados = useCallback(() => {
    setDadosOpened(true);
    setStep("dados");
  }, [setStep]);
  const back = useCallback(() => {
    setStep((current) => {
      if (current === "payment" && (!taxIdOnFile || dadosOpened)) return "dados";
      goToMenu();
      return current;
    });
  }, [dadosOpened, goToMenu, setStep, taxIdOnFile]);
  // Undefined unless Dados was skipped — the payer block keys off its presence,
  // so the decision lives here rather than being re-derived by every caller.
  return { back, editBuyer: taxIdOnFile ? openDados : undefined };
}

/** The message shown when a declared field is missing or malformed. */
const FIELD_COMPLAINT: Record<string, string> = {
  taxId: "CPF inválido.",
  name: "Informe seu nome.",
  email: "E-mail inválido.",
  phone: "Telefone inválido.",
};

/** Which input to highlight for a declared key. */
const FIELD_INPUT: Record<string, BuyerField> = {
  taxId: "cpf",
  name: "name",
  email: "email",
  phone: "phone",
};

/**
 * What the "Continuar" gate objects to, or undefined to advance.
 *
 * The fields come from the chain's own declaration (FUT-595) — absent, they
 * degrade to CPF-required, which is exactly what this gate has always demanded.
 *
 * A blank CPF is only an error when the store has NO CPF for this buyer. With
 * one on file the field starts empty by design (the client is never sent the
 * saved CPF), so demanding one here trapped a returning buyer who opened Dados
 * through "Alterar" and changed their mind: they could not reach Pagamento
 * again, and back only led out to the menu. Leaving it blank means "charge me
 * as before", which is exactly what the server's `resolveBuyerTaxId` does.
 */
function buyerGateError(
  buyer: BuyerInfo,
  fields: readonly CheckoutCustomerField[],
  taxIdOnFile: boolean,
): { message: string; field: BuyerField } | undefined {
  const effective = taxIdOnFile
    ? fields.filter((field) => !(field.key === "taxId" && !buyer.taxId?.trim()))
    : fields;
  const offending = buyerFormComplete(buyer, effective);
  if (!offending) return undefined;
  return {
    message: FIELD_COMPLAINT[offending.key] ?? "Campo obrigatório.",
    field: FIELD_INPUT[offending.key] ?? "cpf",
  };
}

/**
 * Where checkout opens: on the outcome for a buyer returning from a hosted
 * provider, on Pagamento when their CPF is already on file, else on Dados.
 */
function initialStep(resuming: boolean, taxIdOnFile: boolean): Step {
  if (resuming) return "status";
  return taxIdOnFile ? "payment" : "dados";
}

/**
 * Hand the buyer to a redirect provider's own page, if that is where this
 * charge settles (FUT-556).
 *
 * Called BEFORE the order is stored: storing it first would render the PIX or
 * card step for a provider that returned neither, which is the dead end this
 * fixes.
 *
 * A full navigation rather than the host's router, because the destination is
 * another origin. The return trip comes back to this same checkout route
 * carrying `transaction_nsu` + `slug`, which the status poll already reads.
 *
 * @returns true when the buyer is on their way and the caller must stop.
 */
function handOverToProvider(order: CheckoutOrder, navigate: CheckoutNavigate): boolean {
  if (!order.hostedCheckoutUrl) return false;
  // PARK FIRST, navigate second. The order is the only thing the return trip
  // has to rehydrate from, and the navigation may tear this SPA down before
  // any later write lands.
  rememberHostedOrder(order);
  navigate(order.hostedCheckoutUrl);
  return true;
}

/**
 * The leg of checkout that resumes after a hosted provider sent the buyer back
 * (FUT-556).
 *
 * The SPA was torn down by the redirect, so the order is rehydrated from the
 * parked copy — once, on first render — and polled here rather than in a PIX or
 * card view, because a redirect provider produced neither. The webhook is still
 * what settles the order; this only tells the buyer that it did.
 */
function useHostedResume(): { order: CheckoutOrder | null; status: OrderStatus | null } {
  const [order] = useState(takeHostedOrder);
  const { status } = usePaymentPolling(order?.orderId ?? null, { enabled: Boolean(order) });
  return { order, status };
}

/**
 * Fire the host's `onPaid` port once the order settles PAID.
 *
 * FUT-601 made the SERVER empty the cart inside the confirmation transaction —
 * but nothing told the SPA, whose cart provider survives every checkout route
 * change and kept counting the items the buyer had just bought. The server was
 * right and the screen was stale; this is where the host is told to catch up.
 *
 * PAID only. A FAILED or EXPIRED order fires nothing — that shopper still has
 * a basket to retry with, and the host must not be told otherwise.
 */
function usePaidPort(settled: OrderStatus | null, onPaid: (() => void) | undefined): void {
  useEffect(() => {
    if (settled !== "PAID") return;
    onPaid?.();
  }, [settled, onPaid]);
}

/**
 * The create-order refusal the steps render: what to say, which field to
 * highlight, and the machine CODE that decides how it is presented — an
 * unresolved charge is not a failed one, and the Pagamento step must not offer
 * it a "Tentar novamente" (FUT-563). One hook so the three always move
 * together; they were three `useState`s that could be cleared apart.
 */
function useCreateFailure() {
  const [message, setMessage] = useState<string | null>(null);
  const [field, setField] = useState<BuyerField | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const clear = useCallback(() => {
    setMessage(null);
    setField(null);
    setCode(null);
  }, []);
  const fail = useCallback(
    (next: { message: string; field?: BuyerField | null; code?: string }) => {
      setMessage(next.message);
      setField(next.field ?? null);
      setCode(next.code ?? null);
    },
    [],
  );
  return { message, field, code, clear, fail };
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
 *
 * @param taxIdOnFile The buyer already has a CPF saved (FUT-465) ⇒ the Dados
 *   step has nothing left to ask, so checkout opens on Pagamento and `back`
 *   goes to the menu rather than to a form the buyer never saw. The CPF itself
 *   is never in the client's hands — the server reads it from the encrypted
 *   profile when the charge is raised.
 * @param buyerFields What the store's chain declares it needs from the buyer
 *   (FUT-595). Absent ⇒ CPF-required, which is what this gate demanded before
 *   there was a declaration to read — never "ask nothing".
 */
export function useCheckoutController(
  ports: CheckoutHostPorts,
  defaultBuyer?: BuyerInfo,
  taxIdOnFile = false,
  buyerFields: readonly CheckoutCustomerField[] = CPF_ONLY,
) {
  const { createOrder, saveBuyerContact, onExitToMenu, onPaid } = ports;
  const navigate = useCheckoutNavigate();
  const resume = useHostedResume();
  const [step, setStep] = useState<Step>(initialStep(Boolean(resume.order), taxIdOnFile));
  // No method pre-selected: the Pagamento step shows just the picker until the
  // buyer chooses PIX or card, then that method's order is raised and its UI
  // revealed. Avoids raising a throwaway PIX charge for a buyer who wants card.
  const [method, setMethodState] = useState<PaymentMethod | null>(null);
  const [buyer, setBuyerState] = useState<BuyerInfo>(defaultBuyer ?? {});
  const [saveProfile, setSaveProfile] = useState(true);
  const [order, setOrder] = useState<CheckoutOrder | null>(resume.order);
  const [finalStatus, setFinalStatus] = useState<OrderStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const failure = useCreateFailure();

  const clearError = failure.clear;
  const setBuyer = useCallback((next: BuyerInfo) => { setBuyerState(next); clearError(); }, [clearError]);
  const { back, editBuyer } = useCheckoutNav(taxIdOnFile, onExitToMenu, setStep);
  const setMethod = useCallback((next: PaymentMethod) => {
    setMethodState((prev) => { if (prev !== next) { setOrder(null); clearError(); } return next; });
  }, [clearError]);
  const goToPayment = useCallback(() => {
    clearError();
    const complaint = buyerGateError(buyer, buyerFields, taxIdOnFile);
    if (complaint) { failure.fail(complaint); return; }
    // Persist the buyer's details HERE, on "Continuar" — not when a payment is
    // raised. Everything after this step can fail (no provider configured, a
    // declined card, an abandoned PIX, a closed tab) and the details must
    // survive all of it. Fire-and-forget on purpose: making the buyer wait on
    // the write — or blocking them when it fails — would trade the bug for a
    // worse one. Gated on the "salvar meus dados" consent (LGPD), which is
    // what the checkbox means.
    if (saveProfile) {
      saveBuyerContact?.({ name: buyer.name, phone: buyer.phone, taxId: buyer.taxId });
    }
    setStep("payment");
  }, [buyer, buyerFields, saveProfile, taxIdOnFile, clearError, saveBuyerContact]);
  const startPayment = useCallback(async (chosen: PaymentMethod, override?: BuyerInfo) => {
    clearError();
    setCreating(true);
    const result = await createOrder({ method: chosen, buyer: override ?? buyer, saveProfile });
    setCreating(false);
    if (!result.ok) { failure.fail(result.error); return; }
    if (handOverToProvider(result.data, navigate)) return;
    setOrder(result.data);
    setFinalStatus(null);
  }, [buyer, saveProfile, createOrder, clearError, navigate]);
  const payWithEmail = useCallback((email: string) => {
    if (!method) return;
    const next = { ...buyer, email };
    setBuyerState(next);
    void startPayment(method, next);
  }, [buyer, method, startPayment]);
  const handleResolved = useCallback((s: OrderStatus) => { setFinalStatus(s); setStep("status"); }, []);
  const retry = useCallback(() => {
    setOrder(null); setFinalStatus(null); clearError(); setStep("payment");
  }, [clearError]);
  const completed = useMemo(() => new Set(STEP_ORDER.slice(0, STEP_ORDER.indexOf(step))), [step]);
  usePaidPort(finalStatus ?? resume.status, onPaid);

  return {
    step, setStep, method, setMethod, buyer, setBuyer, saveProfile, setSaveProfile,
    order, finalStatus: finalStatus ?? resume.status, creating,
    createError: failure.message, errorField: failure.field, errorCode: failure.code,
    goToMenu: onExitToMenu, back, editBuyer,
    goToPayment, startPayment, payWithEmail, handleResolved, retry, completed,
  };
}
