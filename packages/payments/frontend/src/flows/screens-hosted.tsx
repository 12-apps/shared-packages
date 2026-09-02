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

/**
 * How long this screen keeps asking, and how often — see the twin constants in
 * `use-checkout-controller.ts`, which bounds the same wait for the components
 * layer. 2.5 s for two minutes, then 10 s for thirteen: 126 polls, 15 minutes.
 *
 * Two rates because one cannot serve both ends of this wait — a paying buyer
 * learns within 2.5 s, an abandoned checkout costs a third of what a flat fast
 * rate would. The reasoning is on the twin constants.
 *
 * Stated here rather than imported because the two waits are the same DECISION
 * arrived at twice, not one shared implementation: this screen takes its FAST
 * interval from the host's `polling` config when there is one, and a host that
 * tunes that must not have this package's bound silently mean a different
 * wall-clock window than the constant's comment claims — which is exactly what
 * a bound counted in POLLS did, and why it is counted in milliseconds now
 * (FUT-1144).
 */
const RETURN_FAST_MS = 2_500;
const RETURN_SLOW_MS = 10_000;
const RETURN_FAST_POLLS = (2 * 60_000) / RETURN_FAST_MS;
const RETURN_WINDOW_MS = 15 * 60_000;

/**
 * The two ways this wait stops looking like progress, said as a warning with
 * the buyer's own "ask now" under it (FUT-1144).
 *
 * The button is drawn only when the host wrote a label for it. That is the
 * `returnTimedOut` precedent one step further: a bound with no copy still
 * stops the spinner, and an action with no copy could only be labelled in this
 * package's Portuguese, so it is the one half that stands down.
 */
function ReturnStalled({
  runtime,
  description,
  onCheckAgain,
  testId,
}: {
  runtime: FlowsRuntime;
  description: string | undefined;
  onCheckAgain: () => void;
  testId: string;
}): JSX.Element {
  const { Alert, Button } = useCheckoutComponents();
  return (
    <Box data-testid="checkout-hosted-return" sx={{ py: 4, display: "flex", flexDirection: "column", gap: 2 }}>
      <Alert
        variant="warning"
        title={runtime.copy.returnPending}
        {...(description === undefined ? {} : { description })}
        showIcon
        data-testid={testId}
      />
      {runtime.copy.returnCheckAgain === undefined ? null : (
        <Button
          variant="outline"
          color="neutral"
          size="md"
          onClick={onCheckAgain}
          dataTestId="checkout-hosted-return-check-again"
        >
          {runtime.copy.returnCheckAgain}
        </Button>
      )}
    </Box>
  );
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
    // Bounded, for the reason on RETURN_WINDOW_MS: nothing here can ever reach a
    // terminal state on its own, so an unbounded poll is a spinner the buyer
    // watches until they close the tab.
    const { status, timedOut, error, checkAgain } = usePaymentPolling(parked?.orderId ?? null, {
      enabled: Boolean(parked),
      intervalMs: runtime.config.polling?.intervalMs ?? RETURN_FAST_MS,
      slowAfterPolls: RETURN_FAST_POLLS,
      slowIntervalMs: RETURN_SLOW_MS,
      maxWaitMs: RETURN_WINDOW_MS,
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
    // STOPPED beats STILL TRYING. A wait that failed its way to the wall clock
    // carries both, and the elapsed state is the one that stops asking — and the
    // one whose sentence says not to pay again.
    if (timedOut) {
      return (
        <ReturnStalled
          runtime={runtime}
          description={runtime.copy.returnTimedOut}
          onCheckAgain={checkAgain}
          testId="checkout-hosted-return-timeout"
        />
      );
    }
    if (error !== null) {
      return (
        <ReturnStalled
          runtime={runtime}
          description={runtime.copy.returnUnreachable ?? error}
          onCheckAgain={checkAgain}
          testId="checkout-hosted-return-unreachable"
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
