// @vitest-environment jsdom
/**
 * A raise that comes back ALREADY PAID is a finished checkout, not a payable.
 *
 * The reported defect: a storefront that lets a buyer spend a stored balance
 * settles a fully covered pedido inside its own `POST /api/checkout` and
 * answers with a PAID order carrying no payable at all — no PIX payload, no
 * card key, no hosted link, because there is nothing left to charge. The flow
 * took that order, stored it, and stayed on Pagamento.
 *
 * On a PIX/card store nobody noticed: that screen polls whatever order it is
 * handed, read PAID on its first tick and resolved. On a HAND-OFF store the
 * screen polls nothing, so a paid pedido sat under "Preparando o pagamento"
 * beside an offer to send the buyer to a provider with nothing to collect.
 * Reloading was the only way out — which is exactly why it read as a glitch
 * rather than as a branch nobody had written.
 *
 * These pin the branch itself, at the seam it belongs to: the raise. Both
 * screens are exercised, because a fix that only rescued the hand-off would
 * leave the PIX store depending on a poll to do a job the raise already knew
 * the answer to.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutFlow } from "../checkout-flow";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import { CheckoutNavigateProvider } from "../navigate-context";
import type {
  CheckoutOrder,
  CheckoutProviderConfig,
  CreateOrderRequest,
  CreateOrderResult,
  OrderStatus,
} from "../types";

afterEach(cleanup);

// Every case is a buyer arriving for the first time: a parked order would be
// RESUMED by `useHostedResume` and open on Confirmação for the wrong reason.
beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

/**
 * What the host answers when the balance covered the whole pedido: a settled
 * order and NO payable. The absence is the point — there is no `pix`, no
 * `hostedCheckoutUrl`, and nothing a provider could be asked for.
 */
function settledOrder(status: OrderStatus = "PAID"): CheckoutOrder {
  return {
    orderId: "o-settled",
    status,
    method: "PIX",
    totalCents: 1350,
    subtotalCents: 1350,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: "R$ 13,50",
  };
}

function link(provider: string, screenId: string): CheckoutProviderConfig {
  return {
    provider,
    tokenization: screenId === "hosted-link" ? "REDIRECT" : "PUBLIC_KEY",
    publicKey: screenId === "hosted-link" ? null : "pk_test",
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider,
        displayName: provider === "infinitepay" ? "InfinitePay" : "PagBank",
        tokenization: screenId === "hosted-link" ? "REDIRECT" : "PUBLIC_KEY",
        publicKey: screenId === "hosted-link" ? null : "pk_test",
        mockTokenization: false,
        methods: ["PIX", "CARD"],
        checkoutScreen: screenId,
        customerSchema: [],
      },
    ],
  };
}

const HOSTED = link("infinitepay", "hosted-link");
const ON_PAGE = link("pagbank", "pix-and-card");

function renderFlow(options: {
  createOrder: (input: CreateOrderRequest) => Promise<CreateOrderResult>;
  config: CheckoutProviderConfig;
  navigate?: (url: string) => void;
  onPaid?: () => void;
}): void {
  render(
    <CheckoutNavigateProvider navigate={options.navigate ?? vi.fn()}>
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: false, totalLabel: "R$ 13,50", totalItems: 1 }}
        createOrder={options.createOrder}
        onExitToMenu={vi.fn()}
        onPaid={options.onPaid}
        providerConfig={options.config}
        taxIdOnFile
      />
    </CheckoutNavigateProvider>,
  );
}

/** A `createOrder` port that answers with exactly this order. */
function answers(order: CheckoutOrder): (input: CreateOrderRequest) => Promise<CreateOrderResult> {
  return async () => ({ ok: true, data: order });
}

/** Get past the hand-off store's one control, which is the buyer's own consent. */
async function pressHandOff(): Promise<void> {
  fireEvent.click(await screen.findByTestId("checkout-handoff-start"));
}

describe("an order raised already settled", () => {
  it("lands the hand-off store on Confirmação instead of preparing a payment", async () => {
    const navigate = vi.fn();
    renderFlow({
      createOrder: vi.fn(answers(settledOrder())),
      config: HOSTED,
      navigate,
    });

    await pressHandOff();

    await waitFor(() => expect(screen.getByTestId("payment-status")).toBeTruthy());
    // The three things the stall showed instead, none of which may survive.
    expect(screen.queryAllByTestId("checkout-handoff-pending")).toHaveLength(0);
    expect(screen.queryAllByTestId("checkout-handoff-invite")).toHaveLength(0);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("tells the host it was paid, so the cart is closed", async () => {
    const onPaid = vi.fn();
    renderFlow({
      createOrder: vi.fn(answers(settledOrder())),
      config: HOSTED,
      onPaid,
    });

    await pressHandOff();

    // The host empties the shopper's cart here — a settled pedido that never
    // fires this leaves them holding the basket they just bought.
    await waitFor(() => expect(onPaid).toHaveBeenCalled());
  });

  it("resolves on the PIX/card store from the RAISE, with no poll to wait for", async () => {
    renderFlow({
      createOrder: vi.fn(answers(settledOrder())),
      config: ON_PAGE,
    });

    // Choosing a method is what raises the order on this screen.
    fireEvent.click(await screen.findByTestId("checkout-method-PIX"));

    await waitFor(() => expect(screen.getByTestId("payment-status")).toBeTruthy());
  });

  it("carries the status it was given rather than assuming PAID", async () => {
    // The branch keys on "not awaiting payment", so a host that answers with a
    // terminal FAILED must reach the confirmation as a FAILURE — not as a
    // success, and not as a checkout still waiting for money.
    renderFlow({
      createOrder: vi.fn(answers(settledOrder("FAILED"))),
      config: HOSTED,
    });

    await pressHandOff();

    const status = await screen.findByTestId("payment-status");
    expect(status.textContent).not.toContain("Pedido confirmado");
  });

  it("still hands over when there IS something to pay", async () => {
    // The guard must not swallow the ordinary case: an AWAITING_PAYMENT order
    // with a link is exactly what a hand-off store normally answers.
    const navigate = vi.fn();
    const url = "https://checkout.example.invalid/loja/abc";
    renderFlow({
      createOrder: vi.fn(answers({ ...settledOrder("AWAITING_PAYMENT"), hostedCheckoutUrl: url })),
      config: HOSTED,
      navigate,
    });

    await pressHandOff();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(url));
    expect(screen.queryAllByTestId("payment-status")).toHaveLength(0);
  });
});
