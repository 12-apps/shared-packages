/**
 * The factory's payment screens (FUT-741), part two: taking the money, saying
 * how it went, and saying plainly when the store cannot take it at all.
 */
import { Box } from "@mui/material";
import type { JSX } from "react";

import { CardView } from "../components/checkout/card-view";
import {
  cardChain,
  cardTokenization,
} from "../components/checkout/method-capability";
import { PaymentStatus as PaymentStatusView } from "../components/checkout/payment-status";
import { PixView } from "../components/checkout/pix-view";
import type { CheckoutOrder, OrderStatus } from "../components/checkout/types";
import { useCheckoutComponents } from "../components/checkout/ui";

import { useCatalogExit } from "./catalog-exit";
import { FlowsShell, useResolvedConfig, type FlowsRuntime } from "./runtime";
import type { CheckoutScreens } from "./types";

function buildCardEntry(runtime: FlowsRuntime): CheckoutScreens["CardEntry"] {
  function CardEntryBody({
    payable,
    onResolved,
  }: {
    payable: CheckoutOrder;
    onResolved: (status: OrderStatus) => void;
  }): JSX.Element {
    const { config } = useResolvedConfig(runtime);
    return (
      <CardView
        order={payable}
        providerConfig={cardTokenization(config)}
        // The chain VERBATIM (FUT-563). Nothing here filters, sorts or
        // de-duplicates it: `tokensByProvider` is sent iff the SERVER-published
        // chain has more than one entry, so any tidying done at this layer
        // silently disables failover for the store it exists for.
        providerChain={cardChain(config)}
        tenantSlug={runtime.useTenantSlug()}
        onResolved={onResolved}
        pollIntervalMs={runtime.config.polling?.intervalMs}
      />
    );
  }
  return function CardEntry(props) {
    return (
      <FlowsShell runtime={runtime}>
        <CardEntryBody {...props} />
      </FlowsShell>
    );
  };
}

function buildPixPayment(runtime: FlowsRuntime): CheckoutScreens["PixPayment"] {
  return function PixPayment({
    payable,
    onResolved,
  }: {
    payable: CheckoutOrder;
    onResolved: (status: OrderStatus) => void;
  }) {
    return (
      <FlowsShell runtime={runtime}>
        <PixView
          order={payable}
          onResolved={onResolved}
          pollIntervalMs={runtime.config.polling?.intervalMs}
        />
      </FlowsShell>
    );
  };
}

function buildPaymentStatus(runtime: FlowsRuntime): CheckoutScreens["PaymentStatus"] {
  return function PaymentStatus({
    status,
    payable,
  }: {
    status: OrderStatus | null;
    payable?: CheckoutOrder | null;
  }) {
    // The SAME door the chrome's back link takes (FUT-1240). Bound straight to
    // the port, this control ignored a registered `exit` — so one host got its
    // router from one way out of the checkout and a page load from the other.
    const backToMenu = useCatalogExit(runtime);
    return (
      <FlowsShell runtime={runtime}>
        <PaymentStatusView
          copy={runtime.copy.views.status}
          status={status}
          totalLabel={payable?.totalLabel ?? ""}
          orderId={payable?.orderId}
          onBackToMenu={backToMenu}
          paidExtra={runtime.config.confirmation?.extra}
        />
      </FlowsShell>
    );
  };
}

/**
 * Whether this store can take money at all.
 *
 * An OR, never a swap. `chain.length === 0` is the library's own fact — the
 * server published no enabled provider. The host's veto is a DIFFERENT fact: a
 * store with a perfectly good chain that has switched online payments off. Move
 * the decision entirely to the chain and that store starts offering a checkout
 * it will not honour; move it entirely to the host and a store that simply
 * never connected a provider gets the payment step it cannot serve.
 *
 * While the config is still in flight, neither fact is known — so nothing is
 * refused. The unavailable screen is a statement about the store, and stating
 * it early would be a lie a spinner never tells.
 */
export function storeCannotCharge(
  config: { chain?: unknown[] } | null,
  pending: boolean,
  hostSaysPayable: boolean,
): boolean {
  if (pending) return false;
  if (!hostSaysPayable) return true;
  return config !== null && (config.chain?.length ?? 0) === 0;
}

function buildPaymentsUnavailable(
  runtime: FlowsRuntime,
): CheckoutScreens["PaymentsUnavailable"] {
  function PaymentsUnavailableBody(): JSX.Element {
    const { Alert, Button } = useCheckoutComponents();
    const { remedy } = runtime.useAvailability();
    const copy = runtime.copy;
    if (!remedy) {
      return (
        <Box
          sx={{ display: "flex", flexDirection: "column", gap: 2 }}
          data-testid="checkout-payments-disabled"
        >
          <Alert
            variant="info"
            title={copy.unavailableTitle}
            description={copy.unavailableBody}
            showIcon
          />
        </Box>
      );
    }
    return (
      <Box
        sx={{ display: "flex", flexDirection: "column", gap: 2 }}
        data-testid="checkout-payments-remedy"
      >
        <Alert
          variant="info"
          title={copy.unavailableWithRemedyTitle}
          description={copy.unavailableWithRemedyBody}
          showIcon
        />
        <Button
          variant="solid"
          size="lg"
          onClick={remedy.onSelect}
          dataTestId="checkout-payments-remedy-action"
        >
          {remedy.label}
        </Button>
      </Box>
    );
  }
  return function PaymentsUnavailable() {
    return (
      <FlowsShell runtime={runtime}>
        <PaymentsUnavailableBody />
      </FlowsShell>
    );
  };
}

export const payScreens = {
  buildCardEntry,
  buildPixPayment,
  buildPaymentStatus,
  buildPaymentsUnavailable,
};
