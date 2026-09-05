/**
 * THE TWO SETTLEMENT METHODS THE PACKAGE ITSELF OWNS (FUT-1240).
 *
 * Pix and card, as descriptor rows — the same two the picker has always
 * offered, said in the vocabulary a host's own method can be said in. Both
 * raise a charge, so both mount a `pay`-phase pane; a host's in-person method
 * (pay the courier, pay the waiter) declares `raisesCharge: false` and the
 * engine mounts none.
 *
 * Nothing here names a vendor. `offered()` asks the SERVER-published chain
 * what this store can charge, exactly as `offeredMethods` has since FUT-698,
 * and a config still in flight fails OPEN for the picker while the server
 * still fails the charge closed.
 */
import {
  cardPathAvailable,
  offeredMethods,
} from "../../components/checkout/method-capability";
import type { PaymentMethod } from "../../components/checkout/types";

import type { CheckoutContext, SettlementMethodDescriptor } from "./types";

/** The pane step ids the package's own two methods render into. */
export const PIX_PANE_STEP = "pix";
export const CARD_PANE_STEP = "card";

/** Whether the store's chain declares this method. `null` config ⇒ fail open. */
function chainOffers(ctx: CheckoutContext, method: PaymentMethod): boolean {
  const offered = offeredMethods(ctx.config);
  return offered === null || offered.includes(method);
}

export const PIX_METHOD: SettlementMethodDescriptor = {
  id: "PIX",
  raisesCharge: true,
  pane: PIX_PANE_STEP,
  offered(ctx) {
    return chainOffers(ctx, "PIX");
  },
  tile(copy) {
    const method = copy.screens.screens.method;
    return { label: method.pixLabel, hint: method.pixDescription };
  },
};

export const CARD_METHOD: SettlementMethodDescriptor = {
  id: "CARD",
  raisesCharge: true,
  pane: CARD_PANE_STEP,
  offered(ctx) {
    // Both halves, the same pair the picker has always asked: the chain
    // DECLARES card, and this browser has some way of producing an instrument
    // for it (or the provider's own page takes it).
    return chainOffers(ctx, "CARD") && cardPathAvailable(ctx.config);
  },
  tile(copy) {
    const method = copy.screens.screens.method;
    return { label: method.cardLabel, hint: method.cardDescription };
  },
};

/** The package's rows, in picker order. Frozen: this array IS hook order. */
export const PACKAGE_METHODS: readonly SettlementMethodDescriptor[] = Object.freeze([
  PIX_METHOD,
  CARD_METHOD,
]);

/** Whether an id is one the package's own screens can render a pane for. */
export function isPackageMethod(id: string | null): id is PaymentMethod {
  return id === "PIX" || id === "CARD";
}
