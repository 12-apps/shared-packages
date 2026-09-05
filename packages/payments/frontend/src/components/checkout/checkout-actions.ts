import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { buyerGateError } from "./buyer-gate";
import type { ConfirmationWait } from "./confirmation-wait";
import type { CheckoutDecline } from "./decline";
import { forgetHostedOrder, rememberHostedOrder } from "./hosted-return";
import { parkedBasket, type CheckoutBasketIdentity } from "./basket";
import type { CheckoutNavigate } from "./navigate-context";
import type { CheckoutScreensCopy } from "./screens-copy";
import type {
  BuyerContact,
  BuyerField,
  BuyerInfo,
  CheckoutCustomerField,
  CheckoutOrder,
  CreateOrderRequest,
  CreateOrderResult,
  OrderStatus,
  PaymentMethod,
} from "./types";
import { useResumeEffect, type HostedResume } from "./use-hosted-resume";

/**
 * The controller's own moving parts, one concern per hook.
 *
 * Split out of `./use-checkout-controller.ts` when the resumed leg grew a
 * decision (FUT-1213), a general parked entry (FUT-1140) and a way out
 * (FUT-1146) and that file's one exported function reached its size gate. The
 * seam is the obvious one: everything here is state a step reads, and nothing
 * here knows the ORDER the steps come in.
 */

/** Where the flow can be — the step ids, which are the flow's own contract. */
export type Step = "dados" | "payment" | "status";

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
export function useCheckoutNav(
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
 * WHAT THE CONFIRMATION SCREEN KNOWS ABOUT ITS WAIT, from whichever wait is
 * live.
 *
 * Two can reach that screen and they are mutually exclusive by construction: a
 * checkout RESUMED from a parked entry polls through `useHostedResume`, and one
 * that never left this tab polls through the confirmation wait (FUT-1170) — and
 * that one stands down whenever a resumed order is what put the flow here. So
 * the merge below is a choice between one live wait and one inert one, never a
 * blend of two opinions.
 *
 * All of it is inert for a checkout with an answer already: with nothing to
 * wait on both polls are disabled, so the error stays null, no bound elapses,
 * and none of the actions has a wait to act on.
 *
 * `release` stays the resumed leg's alone. "Não consegui pagar" exists because
 * a provider's own page produces no signal when a buyer abandons it (FUT-1146);
 * a charge raised and still held on THIS page has no such gap to close.
 */
export function resumeSurface(
  resume: HostedResume,
  confirming: ConfirmationWait,
): {
  awaitingTimedOut: boolean;
  awaitingError: string | null;
  awaitingCheckAgain: () => void;
  resumeRelease: (() => void) | undefined;
  resumeReleasing: boolean;
} {
  const live = resume.order === null ? confirming : resume;
  return {
    awaitingTimedOut: live.timedOut,
    awaitingError: live.error,
    awaitingCheckAgain: live.checkAgain,
    resumeRelease: resume.release,
    resumeReleasing: resume.releasing,
  };
}

/**
 * Open the flow on whatever was resumed, and close it again if the buyer
 * releases the order (FUT-1140/FUT-1146).
 *
 * A LAYOUT effect, through `useResumeEffect`: the decision cannot be made
 * during render (it waits for the host's cart), and an ordinary effect runs
 * after paint — so a buyer coming back from a payment would see one frame of
 * the Dados or Pagamento step before their confirmation replaced it.
 */
export function useResumedCheckout(
  resume: HostedResume,
  setOrder: Dispatch<SetStateAction<CheckoutOrder | null>>,
  setStep: Dispatch<SetStateAction<Step>>,
  setFinalStatus: Dispatch<SetStateAction<OrderStatus | null>>,
  setMethod: Dispatch<SetStateAction<PaymentMethod | null>>,
): void {
  const { order, step, released } = resume;
  useResumeEffect(() => {
    if (!order || !step) return;
    setOrder(order);
    setStep(step);
    // The METHOD comes back with it, which matters for a resume that lands on
    // the payment step: the picker keys off it, and a shopper looking at the
    // PIX code they were already paying must not also be asked to choose how
    // to pay. Set through the raw setter on purpose — the public `setMethod`
    // drops the order on a change, which is the opposite of resuming one.
    setMethod(order.method);
  }, [order, step, setOrder, setStep, setMethod]);
  useResumeEffect(() => {
    if (!released) return;
    // Back to a checkout they can actually use, with the basket they are
    // holding. The order they released is gone from this screen; whether it is
    // gone at the provider is the server's answer, not ours.
    setOrder(null);
    setFinalStatus(null);
    setStep("payment");
  }, [released, setOrder, setStep, setFinalStatus]);
}

/**
 * The end of a checkout: tell the host, and let the parked entry go.
 *
 * PAID fires the host's `onPaid` port. FUT-601 made the SERVER empty the cart
 * inside the confirmation transaction — but nothing told the SPA, whose cart
 * provider survives every checkout route change and kept counting the items the
 * buyer had just bought. A FAILED or EXPIRED order fires nothing: that shopper
 * still has a basket to retry with, and the host must not be told otherwise.
 *
 * The parked entry is dropped on ANY terminal status (FUT-1140). It exists to
 * carry one payment across a torn-down SPA; once that payment has an answer,
 * resuming it could only re-show an outcome the buyer has already been given.
 */
export function useSettledPort(settled: OrderStatus | null, onPaid: (() => void) | undefined): void {
  useEffect(() => {
    if (!settled || settled === "AWAITING_PAYMENT") return;
    forgetHostedOrder();
    if (settled === "PAID") onPaid?.();
  }, [settled, onPaid]);
}

/**
 * The create-order refusal the steps render: what to say, which field to
 * highlight, and the machine CODE that decides how it is presented — an
 * unresolved charge is not a failed one, and the Pagamento step must not offer
 * it a "Tentar novamente" (FUT-563). One hook so the three always move
 * together; they were three `useState`s that could be cleared apart.
 */
export function useCreateFailure() {
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
 * "Continuar" on the Dados step: gate on what the store's chain demands, then
 * PERSIST the buyer's details before advancing.
 *
 * The write happens HERE and not when a payment is raised, because everything
 * after this step can fail — no provider configured, a declined card, an
 * abandoned PIX, a closed tab — and the details must survive all of it.
 * Fire-and-forget on purpose: making the buyer wait on the write, or blocking
 * them when it fails, would trade the bug for a worse one. Gated on the
 * "salvar meus dados" consent (LGPD), which is what the checkbox means.
 */
export function useGoToPayment(input: {
  buyer: BuyerInfo;
  buyerFields: readonly CheckoutCustomerField[];
  taxIdOnFile: boolean;
  saveProfile: boolean;
  saveBuyerContact: ((contact: BuyerContact) => void) | undefined;
  validation: CheckoutScreensCopy["validation"];
  failure: { clear: () => void; fail: (next: { message: string; field?: BuyerField | null }) => void };
  setStep: Dispatch<SetStateAction<Step>>;
}): () => void {
  const { buyer, buyerFields, taxIdOnFile, saveProfile, saveBuyerContact } = input;
  const { validation, failure, setStep } = input;
  return useCallback(() => {
    failure.clear();
    const complaint = buyerGateError(validation, buyer, buyerFields, taxIdOnFile);
    if (complaint) {
      failure.fail(complaint);
      return;
    }
    if (saveProfile) {
      saveBuyerContact?.({ name: buyer.name, phone: buyer.phone, taxId: buyer.taxId });
    }
    setStep("payment");
  }, [buyer, buyerFields, saveProfile, taxIdOnFile, failure, saveBuyerContact, validation, setStep]);
}

/**
 * "Tentar novamente" after a refusal — and WHICH order it goes against.
 *
 * A RETRIABLE decline keeps the order (FUT-1145). Minting a new one for every
 * refused card leaves a trail of failed orders in the buyer's own history for
 * one purchase they are still trying to make, and the money rule is unchanged
 * either way: the server refuses a second charge on a payable it has already
 * settled. `freshInstrument` is the other half — the saved card that just
 * failed is not chosen for them again.
 */
export function useRetryAction(input: {
  decline: CheckoutDecline | null;
  order: CheckoutOrder | null;
  clearError: () => void;
  setOrder: Dispatch<SetStateAction<CheckoutOrder | null>>;
  setDecline: Dispatch<SetStateAction<CheckoutDecline | null>>;
  setFinalStatus: Dispatch<SetStateAction<OrderStatus | null>>;
  setStep: Dispatch<SetStateAction<Step>>;
  setFreshInstrument: Dispatch<SetStateAction<boolean>>;
}): () => void {
  const { decline, order, clearError, setOrder, setDecline } = input;
  const { setFinalStatus, setStep, setFreshInstrument } = input;
  return useCallback(() => {
    setFinalStatus(null);
    clearError();
    setStep("payment");
    if (decline?.retriable && order) {
      setFreshInstrument(true);
      return;
    }
    setOrder(null);
    setDecline(null);
    forgetHostedOrder();
  }, [
    clearError, decline, order, setDecline, setFinalStatus, setFreshInstrument, setOrder, setStep,
  ]);
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
  basket?: CheckoutBasketIdentity,
): boolean {
  if (!order.hostedCheckoutUrl) return false;
  // PARK FIRST, navigate second. The order is the only thing the return trip
  // has to rehydrate from, and the navigation may tear this SPA down before
  // any later write lands.
  //
  // The STORE goes with it: one tab holds one slot, and on a multi-tenant
  // storefront every store shares an origin. Without the slug, abandoning this
  // hand-off and opening another store's checkout resumed THIS order there.
  //
  // So does the BASKET (FUT-1213): a hand-off nobody completed must not resume
  // itself over the shopper's next basket, and the only way to tell the two
  // apart later is to record which basket this one was raised from.
  rememberHostedOrder(order, {
    tenantSlug,
    basket: parkedBasket(basket),
    handoff: true,
  });
  navigate(order.hostedCheckoutUrl);
  return true;
}

/**
 * Raise the order for a chosen method, and decide what happens to it.
 *
 * Three outcomes, in order: a refusal the step renders, a HAND-OFF that leaves
 * this page for the provider's own, and an order raised here.
 */
export function useStartPayment(input: {
  buyer: BuyerInfo;
  saveProfile: boolean;
  createOrder: (request: CreateOrderRequest) => Promise<CreateOrderResult>;
  navigate: CheckoutNavigate;
  tenantSlug: string | undefined;
  basket: CheckoutBasketIdentity | undefined;
  failure: { clear: () => void; fail: (next: { message: string; field?: BuyerField | null; code?: string }) => void };
  setCreating: Dispatch<SetStateAction<boolean>>;
  setDecline: Dispatch<SetStateAction<CheckoutDecline | null>>;
  setOrder: Dispatch<SetStateAction<CheckoutOrder | null>>;
  setFinalStatus: Dispatch<SetStateAction<OrderStatus | null>>;
}): (chosen: PaymentMethod, override?: BuyerInfo) => Promise<void> {
  const { buyer, saveProfile, createOrder, navigate, tenantSlug, basket, failure } = input;
  const { setCreating, setDecline, setOrder, setFinalStatus } = input;
  return useCallback(
    async (chosen: PaymentMethod, override?: BuyerInfo) => {
      failure.clear();
      setDecline(null);
      // THE CHARGE BEING REPLACED IS DROPPED FIRST (FUT-1170), before the raise
      // rather than after it. Raising a payment means whatever was on screen is
      // no longer the one being paid, and a provider round trip is long enough
      // for the difference to matter: "Gerar novo código" left the expired
      // charge mounted, so its own view polled it, got the terminal EXPIRED it
      // was always going to get, and bounced the flow to the confirmation
      // screen — where the new charge then landed with nothing polling it.
      //
      // A no-op on every other caller (the auto-raise, the alternate e-mail and
      // the retry all run with no order held), which is the point: the clear
      // belongs to what raising a payment MEANS, not to the one path that
      // noticed.
      setOrder(null);
      setFinalStatus(null);
      setCreating(true);
      const result = await createOrder({ method: chosen, buyer: override ?? buyer, saveProfile });
      setCreating(false);
      if (!result.ok) {
        failure.fail(result.error);
        return;
      }
      if (handOverToProvider(result.data, navigate, tenantSlug, basket)) return;
      // PARKED EVEN THOUGH NOBODY IS LEAVING (FUT-1140). A low-memory phone
      // discards this tab while the shopper is in their bank app, and the SPA
      // that comes back has never heard of the order it raised — so the buyer
      // meets an empty cart and a retry button instead of the confirmation for
      // the payment they just made.
      rememberHostedOrder(result.data, { tenantSlug, basket: parkedBasket(basket) });
      setOrder(result.data);
    },
    [
      buyer, saveProfile, createOrder, failure, navigate, tenantSlug, basket,
      setCreating, setDecline, setOrder, setFinalStatus,
    ],
  );
}
