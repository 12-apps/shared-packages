import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { buyerGateError } from "./buyer-gate";
import { useCheckoutCopy } from "./copy-context";

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
function handOverToProvider(
  order: CheckoutOrder,
  navigate: CheckoutNavigate,
  tenantSlug?: string,
): boolean {
  if (!order.hostedCheckoutUrl) return false;
  // PARK FIRST, navigate second. The order is the only thing the return trip
  // has to rehydrate from, and the navigation may tear this SPA down before
  // any later write lands.
  //
  // The STORE goes with it: one tab holds one slot, and on a multi-tenant
  // storefront every store shares an origin. Without the slug, abandoning this
  // hand-off and opening another store's checkout resumed THIS order there.
  rememberHostedOrder(order, tenantSlug);
  navigate(order.hostedCheckoutUrl);
  return true;
}

/**
 * How long the resumed screen keeps asking, and how often.
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
 * webhook lands (it fires within seconds of the payment, and this rate matches
 * what card and PIX already use), then 10 s for the remaining thirteen. A
 * confirmation is at most 2.5 s late, and an abandoned checkout costs ~126
 * polls instead of the 360 a flat 2.5 s would have.
 *
 * Fifteen minutes because by then a webhook that was ever coming has come. Past
 * that the answer will not change while the buyer watches: the scheduled
 * reconciliation is what rescues a genuinely late one, and it does that whether
 * the tab is open or not.
 *
 * The BOUND is that wall-clock window, not a poll count (FUT-1144). The two are
 * the same number for a healthy wait — 48 × 2.5 s + 78 × 10 s = 15 min — and
 * they part company for the wait that needed bounding: a poll that FAILS
 * incremented nothing, so a connection that never came back left this screen
 * asking, and spinning, with no end at all. A clock cannot be stopped by the
 * failure it is measuring.
 *
 * The card wait is bounded at 90 s (`CARD_AWAITING_WAIT_MS`) because a card
 * authorises inline and a buyer is holding their phone. This leg is the other
 * shape: the buyer has already been off to another site and back, and may
 * legitimately still be finishing there.
 */
const HOSTED_RESUME_FAST_MS = 2_500;
const HOSTED_RESUME_SLOW_MS = 10_000;
/** Two minutes at the fast rate, before the wait is worth economising on. */
const HOSTED_RESUME_FAST_POLLS = (2 * 60_000) / HOSTED_RESUME_FAST_MS;
/** Thirteen more at the slow one — 15 minutes all told. */
const HOSTED_RESUME_WINDOW_MS = 15 * 60_000;

/**
 * The leg of checkout that resumes after a hosted provider sent the buyer back
 * (FUT-556).
 *
 * The SPA was torn down by the redirect, so the order is rehydrated from the
 * parked copy — once, on first render — and polled here rather than in a PIX or
 * card view, because a redirect provider produced neither. The webhook is still
 * what settles the order; this only tells the buyer that it did.
 *
 * And it stops telling them eventually. This poll was the one unbounded wait
 * left in checkout — card and wallet both cap theirs — so a buyer who came back
 * from a payment they never completed got "Confirmando seu pagamento… isso
 * costuma levar alguns segundos" and a spinner, truthfully forever. The screen
 * had no way to reach a terminal state, because the ORDER has none: expiry is
 * PIX-only, and a redirect charge carries no QR window to lapse. `timedOut` is
 * what the screen says instead of spinning.
 *
 * `error` is the half that was dropped on the floor (FUT-1144), and dropping it
 * is what made this leg the SILENT one. The poll below has always been able to
 * fail; this hook returned `status` and `timedOut` and nothing else, so a leg
 * whose every request was failing looked identical to one still waiting — the
 * spinner, forever, with the reason a `console`-less browser away. It is
 * surfaced now, together with the wait's own `checkAgain`, because a screen that
 * says "we cannot reach the payment" and offers nothing to press is only half
 * of an answer.
 */
function useHostedResume(tenantSlug?: string): {
  order: CheckoutOrder | null;
  status: OrderStatus | null;
  timedOut: boolean;
  error: string | null;
  checkAgain: () => void;
} {
  const [order] = useState(() => takeHostedOrder(tenantSlug));
  const { status, timedOut, error, checkAgain } = usePaymentPolling(order?.orderId ?? null, {
    enabled: Boolean(order),
    intervalMs: HOSTED_RESUME_FAST_MS,
    slowAfterPolls: HOSTED_RESUME_FAST_POLLS,
    slowIntervalMs: HOSTED_RESUME_SLOW_MS,
    maxWaitMs: HOSTED_RESUME_WINDOW_MS,
  });
  return { order, status, timedOut, error, checkAgain };
}

/**
 * What the resumed leg contributes to the controller's surface.
 *
 * `resumeTimedOut` is only ever true on that leg — `useHostedResume` is the
 * sole caller that bounds its wait, and a buyer who never left has a card or
 * PIX view reporting its own. `resumeError` and `resumeCheckAgain` are the
 * transient failure and the buyer's way out of it (FUT-1144).
 *
 * All three are inert for a checkout that never left this tab: with nothing
 * parked the poll is disabled, so the error stays null, the bound never
 * elapses, and the action has no wait to restart.
 */
function resumeSurface(resume: ReturnType<typeof useHostedResume>): {
  resumeTimedOut: boolean;
  resumeError: string | null;
  resumeCheckAgain: () => void;
} {
  return {
    resumeTimedOut: resume.timedOut,
    resumeError: resume.error,
    resumeCheckAgain: resume.checkAgain,
  };
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
  tenantSlug?: string,
) {
  const { createOrder, saveBuyerContact, onExitToMenu, onPaid } = ports;
  const validation = useCheckoutCopy().screens.validation;
  const navigate = useCheckoutNavigate();
  const resume = useHostedResume(tenantSlug);
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
    const complaint = buyerGateError(validation, buyer, buyerFields, taxIdOnFile);
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
  }, [buyer, buyerFields, saveProfile, taxIdOnFile, clearError, saveBuyerContact, validation]);
  const startPayment = useCallback(async (chosen: PaymentMethod, override?: BuyerInfo) => {
    clearError();
    setCreating(true);
    const result = await createOrder({ method: chosen, buyer: override ?? buyer, saveProfile });
    setCreating(false);
    if (!result.ok) { failure.fail(result.error); return; }
    if (handOverToProvider(result.data, navigate, tenantSlug)) return;
    setOrder(result.data);
    setFinalStatus(null);
  }, [buyer, saveProfile, createOrder, clearError, navigate, tenantSlug]);
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
    ...resumeSurface(resume),
    createError: failure.message, errorField: failure.field, errorCode: failure.code,
    goToMenu: onExitToMenu, back, editBuyer,
    goToPayment, startPayment, payWithEmail, handleResolved, retry, completed,
  };
}
