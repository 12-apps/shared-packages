/**
 * The hosted handover, as two SCREENS (FUT-741) — the leg of checkout that had
 * none.
 *
 * Today a redirect provider's link (FUT-556) and a 3-DS challenge (FUT-698) are
 * both a bare `window.location.assign` buried in a hook. When the navigation
 * works, nobody notices. When it does not — a popup/redirect blocker, a slow
 * DNS, an in-app webview that refuses cross-origin navigations, a buyer who
 * taps back — the buyer is left looking at a page that says nothing, offers
 * nothing, and has already raised a charge.
 *
 * So: an interstitial that PARKS the order first, then navigates, and renders
 * an explicit link as the fallback the assign never had. And the return leg as
 * a screen of its own, so "rehydrate the parked order and poll it to a terminal
 * state" is something a host can mount at its return route rather than
 * something that only happens if the buyer lands back on the exact component
 * that left.
 *
 * ORDERING IS LOAD-BEARING: park, then navigate. The navigation may tear this
 * SPA down at any point after it starts, and a return trip that finds nothing
 * parked drops the buyer on a blank confirmation after they have paid.
 */
import { Box } from "@mui/material";
import { useEffect, useState, type JSX } from "react";

import { rememberHostedOrder, takeHostedOrder } from "../components/checkout/hosted-return";
import type { CheckoutOrder, OrderStatus } from "../components/checkout/types";
import { useCheckoutComponents } from "../components/checkout/ui";
import { usePaymentPolling } from "../components/checkout/use-payment-polling";

import { FlowsShell, type FlowsRuntime } from "./runtime";
import type { CheckoutScreens } from "./types";

/** Park the order, then navigate — exactly once, even under StrictMode. */
function useHandover(payable: CheckoutOrder, url: string, navigate: (url: string) => void): void {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    setDone(true);
    rememberHostedOrder(payable);
    navigate(url);
  }, [done, payable, url, navigate]);
}

function buildHostedHandoff(runtime: FlowsRuntime): CheckoutScreens["HostedHandoff"] {
  function HostedHandoffBody({
    url,
    payable,
    onCancel,
  }: {
    url: string;
    payable: CheckoutOrder;
    onCancel?: () => void;
  }): JSX.Element {
    const { Button, LoadingState, Text } = useCheckoutComponents();
    const copy = runtime.copy;
    useHandover(payable, url, runtime.navigate);
    return (
      <Box
        data-testid="checkout-hosted-handoff"
        sx={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "center", py: 4 }}
      >
        <Text variant="heading" size="md" weight="bold" as="h2">
          {copy.handoffTitle}
        </Text>
        <Text variant="body" size="sm" color="secondary" as="p">
          {copy.handoffBody}
        </Text>
        <LoadingState variant="spinner" size="md" message="" dataTestId="checkout-hosted-waiting" />
        {/* A real anchor, not a second scripted navigation: when the scripted
            one was blocked, another one will be too. This is the affordance a
            bare `location.assign` never had. */}
        <a href={url} data-testid="checkout-hosted-link" rel="noreferrer">
          {copy.handoffLink}
        </a>
        {onCancel ? (
          <Button
            variant="text"
            color="neutral"
            size="sm"
            onClick={onCancel}
            dataTestId="checkout-hosted-cancel"
          >
            {copy.handoffCancel}
          </Button>
        ) : null}
      </Box>
    );
  }
  return function HostedHandoff(props) {
    return (
      <FlowsShell runtime={runtime}>
        <HostedHandoffBody {...props} />
      </FlowsShell>
    );
  };
}

function buildHostedReturn(runtime: FlowsRuntime): CheckoutScreens["HostedReturn"] {
  function HostedReturnBody({
    onResolved,
  }: {
    onResolved: (status: OrderStatus) => void;
  }): JSX.Element {
    const { Alert, LoadingState } = useCheckoutComponents();
    // Read-and-clear, once, on first render: the resumed view belongs to
    // exactly one return trip.
    const [parked] = useState(takeHostedOrder);
    const { status } = usePaymentPolling(parked?.orderId ?? null, {
      enabled: Boolean(parked),
      intervalMs: runtime.config.polling?.intervalMs,
    });

    useEffect(() => {
      if (status && status !== "AWAITING_PAYMENT") onResolved(status);
    }, [status, onResolved]);

    if (!parked) {
      return (
        <Alert
          variant="info"
          title={runtime.copy.returnPending}
          description={runtime.copy.returnUnknown}
          showIcon
          data-testid="checkout-hosted-return-unknown"
        />
      );
    }
    return (
      <Box data-testid="checkout-hosted-return" sx={{ py: 4 }}>
        <LoadingState
          variant="spinner"
          size="md"
          message={runtime.copy.returnPending}
          dataTestId="checkout-hosted-return-waiting"
        />
      </Box>
    );
  }
  return function HostedReturn(props) {
    return (
      <FlowsShell runtime={runtime}>
        <HostedReturnBody {...props} />
      </FlowsShell>
    );
  };
}

export const hostedScreens = { buildHostedHandoff, buildHostedReturn };
