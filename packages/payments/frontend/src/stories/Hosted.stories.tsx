import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import type { PaymentFlows } from "../flows/types";
import type { CheckoutOrder, OrderStatus } from "../index";

import { StoryFlow } from "./host";

/**
 * The hosted handover, and the leg that comes back (FUT-741/742).
 *
 * Before this, both were a bare `window.location.assign` inside a hook. When
 * the navigation works nobody notices; when it is blocked, slow, or refused by
 * an in-app webview, the buyer is left on a page that says nothing and offers
 * nothing — with a charge already raised.
 *
 * These stories record the navigation rather than following it (a story that
 * really navigated would leave Storybook), which is exactly the point: the
 * departure is OBSERVABLE now, and the explicit link below it is the fallback
 * a scripted assign can never be.
 */
const meta: Meta = { title: "Checkout/Hosted handover" };
export default meta;

const PAYABLE: CheckoutOrder = {
  orderId: "inv_2026_0043",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 7500,
  subtotalCents: 7500,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 75,00",
  hostedCheckoutUrl: "https://aurora.example/checkout/stub_aurora_inv_2026_0043",
};

/** Shows where the buyer WOULD have gone, instead of going there. */
function HandoffDemo({
  flows,
  navigated,
  withCancel,
}: {
  flows: PaymentFlows;
  navigated: { url: string | null };
  withCancel: boolean;
}): JSX.Element {
  const [, force] = useState(0);
  return (
    <>
      <flows.screens.HostedHandoff
        url={PAYABLE.hostedCheckoutUrl ?? ""}
        payable={PAYABLE}
        onCancel={withCancel ? () => force((n) => n + 1) : undefined}
      />
      <p style={{ opacity: 0.6, fontSize: 12 }}>
        navigate() recebeu: <code>{navigated.url ?? "—"}</code>
      </p>
      <p style={{ opacity: 0.6, fontSize: 12 }}>
        O pedido foi PARKED antes da navegação — é a única coisa de que a volta
        consegue se reidratar.
      </p>
    </>
  );
}

function handoffStory(withCancel: boolean): StoryObj {
  return {
    render: () => {
      // A CONTAINER, so the port records into a property rather than
      // reassigning a binding it closed over.
      const navigated: { url: string | null } = { url: null };
      return (
        <StoryFlow
          host={{
            onNavigate: (url) => {
              navigated.url = url;
            },
          }}
        >
          {(flows) => (
            <HandoffDemo flows={flows} navigated={navigated} withCancel={withCancel} />
          )}
        </StoryFlow>
      );
    },
  };
}

/** Parks, navigates, and offers the link when the navigation does not happen. */
export const Interstitial: StoryObj = handoffStory(false);

/** …with a way back for a host that wants one. */
export const InterstitialWithCancel: StoryObj = handoffStory(true);

/**
 * The RETURN leg, as a screen a host can mount at its return route.
 *
 * With nothing parked — a buyer who abandoned the provider's page and came back
 * later — it says so rather than showing a confirmation for a payment nobody
 * can find. With a parked order it polls to a terminal state.
 */
export const ReturnWithNothingParked: StoryObj = {
  render: () => (
    <StoryFlow>
      {(flows) => <ReturnDemo flows={flows} />}
    </StoryFlow>
  ),
};

function ReturnDemo({ flows }: { flows: PaymentFlows }): JSX.Element {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  return (
    <>
      <flows.screens.HostedReturn onResolved={setStatus} />
      <p style={{ opacity: 0.6, fontSize: 12 }}>resolvido: {status ?? "—"}</p>
    </>
  );
}
