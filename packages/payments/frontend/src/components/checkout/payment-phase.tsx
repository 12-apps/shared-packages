import type { JSX } from "react";

import type { CheckoutFlowProps } from "./checkout-flow";
import { PaymentListStep } from "./list/payment-list-step";
import type { SettlementCheckout } from "./types";
import type { useCheckoutController } from "./use-checkout-controller";

/**
 * Step 2 of `<CheckoutFlow>`: the Pagamento step, which is the ONE list
 * (FUT-3591, FUT-4028) — the store's online options and the host's door
 * options in one radio group, the buyer's missing CPF asked at the top.
 */

/** The pay-bar total override when settling a settlement (else the cart's own totals). */
function settlementTotalOverride(
  settlement: SettlementCheckout | null | undefined,
): { label: string; items: number } | undefined {
  return settlement ? { label: settlement.totalLabel, items: settlement.totalItems } : undefined;
}

/** Step 2: the one list, with the controller's facts and the host's money mapped onto it. */
export function PaymentPhase({
  props,
  c,
}: {
  props: Omit<CheckoutFlowProps, "components">;
  c: ReturnType<typeof useCheckoutController>;
}): JSX.Element {
  const { cart, settlement, providerConfig, tenantSlug, validateApplePayMerchant, paymentList } = props;
  return (
    <PaymentListStep
      c={c}
      list={paymentList}
      cart={cart}
      totalOverride={settlementTotalOverride(settlement)}
      providerConfig={providerConfig}
      tenantSlug={tenantSlug}
      taxIdOnFile={props.taxIdOnFile ?? false}
      taxIdKindOnFile={props.taxIdKindOnFile ?? null}
      defaultBuyer={props.defaultBuyer}
      saveBuyerContact={props.saveBuyerContact}
      consentLabel={props.copy.consent.saveProfile}
      validateApplePayMerchant={validateApplePayMerchant}
    />
  );
}
