import type { JSX } from "react";

import type { CheckoutCartView, CheckoutFlowProps } from "./checkout-flow";
import { PaymentStep } from "./checkout-steps";
import { PaymentListStep } from "./list/payment-list-step";
import { OneClickProvider } from "./one-click";
import type { CheckoutProviderConfig, SettlementCheckout } from "./types";
import type { useCheckoutController } from "./use-checkout-controller";

/**
 * Step 2 of `<CheckoutFlow>`, moved out of `./checkout-flow.tsx` at its size
 * gate when the Pagamento step gained a second shape (FUT-3591): the method
 * tabs it always had, or the one list a host opts into.
 */

/** The pay-bar total override when settling a settlement (else the cart's own totals). */
export function settlementTotalOverride(
  settlement: SettlementCheckout | null | undefined,
): { label: string; items: number } | undefined {
  return settlement ? { label: settlement.totalLabel, items: settlement.totalItems } : undefined;
}

/** Step 2, with the controller's facts and the host's money mapped onto it. */
function PagamentoStep({
  c,
  cart,
  settlement,
  providerConfig,
  tenantSlug,
  validateApplePayMerchant,
}: {
  c: ReturnType<typeof useCheckoutController>;
  cart: CheckoutCartView;
  settlement: SettlementCheckout | null | undefined;
  providerConfig: CheckoutProviderConfig | null | undefined;
  tenantSlug: string | undefined;
  validateApplePayMerchant: ((validationURL: string) => Promise<unknown>) | undefined;
}): JSX.Element {
  return (
    <PaymentStep
      method={c.method}
      onMethodChange={c.setMethod}
      order={c.order}
      buyer={c.buyer}
      creating={c.creating}
      createError={c.createError}
      errorField={c.errorField}
      errorCode={c.errorCode}
      onGenerate={(chosen) => void c.startPayment(chosen)}
      refresh={c.refresh}
      onUseEmail={c.payWithEmail}
      // Set only for a skipped-Dados flow (the controller decides); the payer
      // block hides itself when it is absent.
      onEditBuyer={c.editBuyer}
      providerConfig={providerConfig}
      tenantSlug={tenantSlug}
      // The amount, on the step that asks for it (FUT-1179).
      cartTotals={cart}
      totalOverride={settlementTotalOverride(settlement)}
      discountLines={cart.discountLines}
      // The order around the payment, for the summary (FUT-3525).
      lines={cart.lines}
      delivery={cart.delivery}
      orderNote={cart.orderNote}
      // Retrying a refused card: the failed saved card is not chosen again (FUT-1145).
      freshInstrument={c.freshInstrument}
      // The card path parks an order of its own for a 3-D Secure challenge, so
      // it needs the same basket the flow was mounted for (FUT-1213).
      basket={cart.identity}
      validateApplePayMerchant={validateApplePayMerchant}
      onResolved={c.handleResolved}
    />
  );
}

/**
 * Step 2, in whichever shape the host asked for: the one list, or the tabs.
 * The list never arms one-click — it raises nothing on its own, which is the
 * one-click request's ordinary degraded outcome anyway.
 */
export function PaymentPhase({
  props,
  c,
  armed,
}: {
  props: Omit<CheckoutFlowProps, "components">;
  c: ReturnType<typeof useCheckoutController>;
  armed: boolean;
}): JSX.Element {
  const { cart, settlement, providerConfig, tenantSlug, validateApplePayMerchant, paymentList } = props;
  if (paymentList) {
    return (
      <PaymentListStep
        c={c}
        list={paymentList}
        cart={cart}
        totalOverride={settlementTotalOverride(settlement)}
        providerConfig={providerConfig}
        tenantSlug={tenantSlug}
        taxIdOnFile={props.taxIdOnFile ?? false}
        defaultBuyer={props.defaultBuyer}
        saveBuyerContact={props.saveBuyerContact}
      />
    );
  }
  return (
    <OneClickProvider armed={armed}>
      <PagamentoStep
        c={c}
        cart={cart}
        settlement={settlement}
        providerConfig={providerConfig}
        tenantSlug={tenantSlug}
        validateApplePayMerchant={validateApplePayMerchant}
      />
    </OneClickProvider>
  );
}
