import { useCallback, type Dispatch, type SetStateAction } from "react";

import { parkedBasket, type CheckoutBasketIdentity } from "./basket";
import type { Step } from "./checkout-actions";
import type { CheckoutDecline } from "./decline";
import { rememberHostedOrder } from "./hosted-return";
import type { CheckoutNavigate } from "./navigate-context";
import type {
  BuyerField,
  BuyerInfo,
  CheckoutOrder,
  CreateOrderRequest,
  CreateOrderResult,
  OrderStatus,
  PaymentMethod,
} from "./types";

/**
 * RAISING the order, and what becomes of it.
 *
 * Split out of `./checkout-actions.ts` when that file reached its 400-line gate
 * — the same seam it was itself split along. What is here is the one moment the
 * flow asks the host for an order and then has to decide, from the answer
 * alone, which of four things is true: it was refused, it is already finished,
 * it is payable somewhere else, or it is payable here.
 */

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
 * FOUR outcomes, in order: a refusal the step renders, an order that came back
 * ALREADY RESOLVED, a HAND-OFF to the provider's own page, and an order raised
 * here to be paid on this one.
 *
 * The resolved case is first because a raise does not always leave something to
 * pay: a host whose buyer spends a stored balance settles a fully covered
 * pedido server-side and answers PAID with no payable at all. That used to fall
 * through and merely `setOrder`, leaving the flow on Pagamento holding a paid
 * pedido — invisible on the PIX/card screen, which polls and resolves itself,
 * and a dead end on the hand-off screen, which polls nothing and so offered a
 * provider a charge that no longer existed. Reading `status` rather than the
 * absence of a payable is what tells that apart from a failed raise.
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
  /** Moves the flow to Confirmação for an order that needs no payment. */
  setStep: Dispatch<SetStateAction<Step>>;
}): (chosen: PaymentMethod, override?: BuyerInfo) => Promise<void> {
  const { buyer, saveProfile, createOrder, navigate, tenantSlug, basket, failure } = input;
  const { setCreating, setDecline, setOrder, setFinalStatus, setStep } = input;
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
      // NOTHING LEFT TO PAY — see the docblock. Parked first for the same
      // reason every other raised order is: the confirmation this is about to
      // show has to survive a tab the phone discards on the way to it.
      if (result.data.status !== "AWAITING_PAYMENT") {
        rememberHostedOrder(result.data, { tenantSlug, basket: parkedBasket(basket) });
        setOrder(result.data);
        setFinalStatus(result.data.status);
        setStep("status");
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
      setCreating, setDecline, setOrder, setFinalStatus, setStep,
    ],
  );
}