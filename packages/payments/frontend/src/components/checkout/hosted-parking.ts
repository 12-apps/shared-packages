import { createContext, useCallback, useContext } from "react";

import { forgetHostedOrder } from "./hosted-store";

/**
 * WHETHER THIS MOUNT USES THE TAB'S PARKED-PAYMENT SLOT AT ALL.
 *
 * A checkout parks every order it raises in one per-tab slot
 * (`HOSTED_ORDER_STORAGE_KEY`) and resumes the slot on its next mount, so a
 * payment survives a hand-off or a discarded tab (FUT-556, FUT-1140). That is
 * right for a host's ONE checkout, and wrong for a second mount of the flow
 * that pays something the host already tracks itself: a pedido paid again from
 * its own page. There, a Pix raised in the sheet was parked basket-less, so
 * the next checkout resumed it over a cart nobody had ordered; and the sheet's
 * own mount took the checkout's parked Pix, polled that order and closed as
 * paid.
 *
 * `false` (`CheckoutFlow`'s `parkHostedOrders`) skips what happens ON THE
 * PAGE: the park of an order raised here (and of one that came back already
 * settled), the resume on mount, and every forget — so the slot stays as the
 * host's checkout left it. A HAND-OFF still parks (the provider's redirect,
 * a card's or a wallet's 3-D Secure): the page this mount lives on is gone
 * after it, the provider returns to the host's checkout route, and the entry
 * is what lets that route show the buyer the payment they made. Default
 * `true`, which is every mount before this existed.
 *
 * `createPaymentFlows`' Checkout screen does not pass this: it is the host's
 * one checkout, and always parks.
 */
export const HostedParkingContext = createContext(true);

/** Whether this mount parks, resumes and forgets — see {@link HostedParkingContext}. */
export function useHostedParking(): boolean {
  return useContext(HostedParkingContext);
}

/** `forgetHostedOrder`, or nothing on a mount that keeps out of the slot. */
export function useForgetHostedOrder(): (tenantSlug?: string) => void {
  const parks = useHostedParking();
  return useCallback(
    (tenantSlug?: string) => {
      if (parks) forgetHostedOrder(tenantSlug);
    },
    [parks],
  );
}
