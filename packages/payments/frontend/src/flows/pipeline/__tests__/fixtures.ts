// Shared fixtures for the pipeline suites.
import type { CheckoutOrder } from "../../../components/checkout/types";
import type {
  CheckoutContext,
  SettlementMethodDescriptor,
} from "../types";

/** A context at rest: a store with a live chain and a basket with one line. */
export function ctxOf(over: Partial<CheckoutContext> = {}): CheckoutContext {
  return {
    tenantSlug: "loja-1",
    config: {
      provider: "stub",
      tokenization: "PUBLIC_KEY",
      publicKey: "pk",
      mockTokenization: true,
      methods: ["PIX", "CARD"],
      chain: [
        {
          provider: "stub",
          tokenization: "PUBLIC_KEY",
          publicKey: "pk",
          mockTokenization: true,
          methods: ["PIX", "CARD"],
        },
      ],
    },
    configPending: false,
    cart: { empty: false, totalLabel: "R$ 7,00", totalItems: 1 },
    settlement: null,
    buyer: {},
    taxIdOnFile: false,
    method: null,
    order: null,
    outcome: null,
    intent: { oneClick: false, resuming: false, presetMethod: null },
    slices: {},
    ...over,
  };
}

/** An order as the create port answers it. */
export function orderOf(over: Partial<CheckoutOrder> = {}): CheckoutOrder {
  return {
    orderId: "o-1",
    status: "AWAITING_PAYMENT",
    method: "PIX",
    totalCents: 700,
    subtotalCents: 700,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: "R$ 7,00",
    ...over,
  };
}

/**
 * A settlement that raises NO charge — the shape a host registers for "pay the
 * courier" or "pay the waiter". Two of them, because the acceptance asks for
 * one case per no-charge method and one row could pass by accident.
 */
function noChargeMethod(id: string): SettlementMethodDescriptor {
  return {
    id,
    raisesCharge: false,
    pane: null,
    offered: () => true,
    tile: () => ({ label: id }),
  };
}

export const NO_CHARGE_METHODS = [
  noChargeMethod("ON_DELIVERY"),
  noChargeMethod("WAITER"),
] as const;
