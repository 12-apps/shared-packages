// @vitest-environment jsdom
/**
 * ALL FOUR PARKS TAKE THE SLUG (FUT-1240, closing PAY-10).
 *
 * A checkout in flight is parked in `sessionStorage`, and on a multi-tenant
 * storefront every store shares ONE origin — so one tab holds one slot for all
 * of them. `belongsHere` passes an entry with no slug at ANY store, which is
 * what makes an unscoped write dangerous rather than merely untidy: store A's
 * abandoned hand-off resumed on store B's checkout, showing a confirmation for
 * an unrelated order and skipping B's own payment.
 *
 * FUT-556 closed that on the READ side. Three of the four writes never learned
 * it: the wallet's 3-D Secure hand-off, the factory's hand-off screen, and the
 * controller's clear-on-method-change — which is a write too, and the one that
 * threw ANOTHER store's parked payment away.
 *
 * One case per park, at the seam that actually writes.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { JSX } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handOverToChallenge } from "../../../components/checkout/card-outcome";
import { CheckoutFlow } from "../../../components/checkout/checkout-flow";
import { CheckoutClientProvider } from "../../../components/checkout/client-context";
import { CheckoutCopyProvider } from "../../../components/checkout/copy-context";
import {
  HOSTED_ORDER_STORAGE_KEY,
  rememberHostedOrder,
} from "../../../components/checkout/hosted-return";
import { CheckoutNavigateProvider } from "../../../components/checkout/navigate-context";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../../../components/checkout/pt-BR";
import { createCheckoutClient } from "../../../components/checkout/transport";
import { useWalletCharge } from "../../../components/checkout/use-wallet-charge";

import { orderOf } from "./fixtures";
import { buildHost, STUB_CONFIG } from "./pipeline-host";

afterEach(cleanup);
beforeEach(() => window.sessionStorage.clear());

/** What is in the tab's one slot right now. */
function parked(): { tenantSlug?: string; basket?: string | null } | null {
  const raw = window.sessionStorage.getItem(HOSTED_ORDER_STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as { tenantSlug?: string });
}

const HOSTED = "https://provider.example/pay/1";

describe("park 1 — the card path's 3-D Secure challenge", () => {
  it("records the store and the basket it was raised for", () => {
    handOverToChallenge(orderOf(), HOSTED, () => undefined, {
      tenantSlug: "loja-a",
      basket: { signature: "sig-1", ready: true },
    });
    expect(parked()).toMatchObject({ tenantSlug: "loja-a", basket: "sig-1" });
  });
});

describe("park 2 — the wallet's redirect hand-off", () => {
  /** A mount that answers one charge with a provider's own page. */
  function walletClient(): ReturnType<typeof createCheckoutClient> {
    const fetchImpl = async (): Promise<Response> =>
      new Response(JSON.stringify({ data: { status: "AWAITING_PAYMENT", hostedCheckoutUrl: HOSTED } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    return createCheckoutClient({
      fetchImpl: fetchImpl as typeof fetch,
      copy: PT_BR_CHECKOUT_VIEW_COPY.screens.screens.transport,
    });
  }

  it("records the store and the basket it was raised for", async () => {
    const navigate = vi.fn<(url: string) => void>();
    function Probe(): JSX.Element {
      const wallet = useWalletCharge(orderOf(), {}, () => undefined, 2500, {
        tenantSlug: "loja-a",
        basket: { signature: "sig-1", ready: true },
      });
      return (
        <button
          type="button"
          data-testid="pay"
          onClick={() => void wallet.payWithKey("GOOGLE_PAY", "key")}
        />
      );
    }
    render(
      <CheckoutCopyProvider copy={PT_BR_CHECKOUT_VIEW_COPY.screens}>
        <CheckoutClientProvider client={walletClient()}>
          <CheckoutNavigateProvider navigate={navigate}>
            <Probe />
          </CheckoutNavigateProvider>
        </CheckoutClientProvider>
      </CheckoutCopyProvider>,
    );
    fireEvent.click(screen.getByTestId("pay"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(HOSTED));
    expect(parked()).toMatchObject({ tenantSlug: "loja-a", basket: "sig-1", handoff: true });
  });
});

describe("park 3 — the factory's hand-off screen", () => {
  it("records the store the checkout is mounted for", async () => {
    const navigate = vi.fn<(url: string) => void>();
    const { flows } = buildHost({}, { tenantSlug: "loja-a", navigate });
    render(<flows.screens.HostedHandoff url={HOSTED} payable={orderOf()} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(HOSTED));
    expect(parked()).toMatchObject({ tenantSlug: "loja-a", handoff: true });
  });
});

describe("park 4 — the controller dropping an order on a method change", () => {
  it("leaves ANOTHER store's parked checkout where it is", async () => {
    // Store B's shopper is mid-hand-off; store A's shopper changes method in
    // the same tab. Unscoped, this clear threw B's payment away.
    rememberHostedOrder(orderOf(), { tenantSlug: "loja-b", handoff: true });
    render(
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: false, totalLabel: "R$ 7,00", totalItems: 1 }}
        // Never settles: the click must not go on to raise an order of its own
        // and park it over the entry this case is about.
        createOrder={() => new Promise(() => undefined)}
        onExitToMenu={() => undefined}
        providerConfig={STUB_CONFIG}
        tenantSlug="loja-a"
        taxIdOnFile
      />,
    );
    fireEvent.click(await screen.findByTestId("checkout-method-CARD"));
    await waitFor(() => expect(parked()).toMatchObject({ tenantSlug: "loja-b" }));
  });

  it("still clears its OWN store's parked checkout", async () => {
    rememberHostedOrder(orderOf(), { tenantSlug: "loja-a", handoff: false });
    render(
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: false, totalLabel: "R$ 7,00", totalItems: 1 }}
        createOrder={() => new Promise(() => undefined)}
        onExitToMenu={() => undefined}
        providerConfig={STUB_CONFIG}
        tenantSlug="loja-a"
        taxIdOnFile
      />,
    );
    fireEvent.click(await screen.findByTestId("checkout-method-CARD"));
    await waitFor(() => expect(parked()).toBeNull());
  });
});
