// @vitest-environment jsdom
/**
 * A hand-off checkout asks the method question ONCE, and not here.
 *
 * The reported defect: a store on InfinitePay opened Pagamento with the PIX /
 * Cartão picker, the buyer chose one, and the provider's own page then asked
 * them the same question again — because every method mints the same checkout
 * link, so the first answer had never been binding. Two asks, one of which is
 * a lie about what it decides.
 *
 * So the shell hides its picker for a screen that hands the buyer over, and
 * that screen offers a single "Seguir para o pagamento" which says where it
 * leads. These pin the three halves of that: the picker is GONE, the button is
 * the only way forward, and pressing it raises exactly one charge and leaves
 * for the provider's page.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutFlow } from "../checkout-flow";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import { CheckoutNavigateProvider } from "../navigate-context";
import type {
  CheckoutChainLink,
  CheckoutOrder,
  CheckoutProviderConfig,
  CreateOrderRequest,
  CreateOrderResult,
} from "../types";

afterEach(cleanup);

// The hand-off PARKS its order in sessionStorage before navigating away, so a
// checkout mounted afterwards would RESUME it (`useHostedResume`) and open on
// Confirmação instead of Pagamento. Clearing between cases keeps each one a
// buyer arriving for the first time.
beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

const HOSTED_URL = "https://checkout.example.invalid/loja/gmTq1EgYrP";

/** What a hand-off provider answers with: a page elsewhere, no QR, no form. */
const HOSTED_ORDER: CheckoutOrder = {
  orderId: "o-handoff",
  status: "AWAITING_PAYMENT",
  method: "PIX",
  totalCents: 4200,
  subtotalCents: 4200,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 42,00",
  hostedCheckoutUrl: HOSTED_URL,
};

/**
 * A store connected to a hand-off provider, shaped exactly as InfinitePay's
 * adapter declares itself: both methods, `REDIRECT` tokenization, the
 * `hosted-link` screen, and a name to show the buyer.
 */
function hostedStore(over: Partial<CheckoutChainLink> = {}): CheckoutProviderConfig {
  return {
    provider: "infinitepay",
    tokenization: "REDIRECT",
    publicKey: null,
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "infinitepay",
        displayName: "InfinitePay",
        tokenization: "REDIRECT",
        publicKey: null,
        mockTokenization: false,
        methods: ["PIX", "CARD"],
        checkoutScreen: "hosted-link",
        // No CPF: this provider's own page asks for what it needs, so Dados is
        // out of the way and Pagamento is the first screen.
        customerSchema: [],
        ...over,
      },
    ],
  };
}

/** A `createOrder` port that always answers with the hand-off order. */
function handsOver(): (input: CreateOrderRequest) => Promise<CreateOrderResult> {
  return async () => ({ ok: true, data: HOSTED_ORDER });
}

function renderHandOff(options: {
  createOrder: (input: CreateOrderRequest) => Promise<CreateOrderResult>;
  navigate?: (url: string) => void;
  config?: CheckoutProviderConfig;
}): void {
  render(
    <CheckoutNavigateProvider navigate={options.navigate ?? vi.fn()}>
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: false, totalLabel: "R$ 42,00", totalItems: 1 }}
        createOrder={options.createOrder}
        onExitToMenu={vi.fn()}
        providerConfig={options.config ?? hostedStore()}
        // A buyer with a CPF on file opens straight on Pagamento (FUT-465),
        // which is the screen under test.
        taxIdOnFile
      />
    </CheckoutNavigateProvider>,
  );
}

describe("Pagamento at a store that finishes on the provider's page", () => {
  it("offers no PIX/card picker — the choice is not ours to ask", async () => {
    renderHandOff({ createOrder: vi.fn(handsOver()) });

    await waitFor(() => expect(screen.getByTestId("checkout-handoff-invite")).toBeTruthy());
    expect(screen.queryAllByTestId("checkout-method")).toHaveLength(0);
    expect(screen.queryAllByTestId("checkout-method-PIX")).toHaveLength(0);
    expect(screen.queryAllByTestId("checkout-method-CARD")).toHaveLength(0);
  });

  it("says where the buyer is going, in whose name, and that they come back", async () => {
    renderHandOff({ createOrder: vi.fn(handsOver()) });

    const invite = await screen.findByTestId("checkout-handoff-invite");
    expect(invite.textContent).toContain("InfinitePay");
    // The methods are promised HERE because they are chosen THERE — that is the
    // whole substitution this screen makes for the picker it replaced.
    expect(invite.textContent).toContain("PIX ou cartão");
    expect(invite.textContent).toContain("volta para cá");
    expect(screen.getByTestId("checkout-handoff-start").textContent).toContain(
      "Seguir para o pagamento",
    );
  });

  it("raises ONE charge on the press and leaves for the provider's page", async () => {
    const createOrder = vi.fn(handsOver());
    const navigate = vi.fn();
    renderHandOff({ createOrder, navigate });

    await screen.findByTestId("checkout-handoff-start");
    // Nothing has been charged just by arriving: the press is the buyer's
    // consent to leave the storefront, and it must be theirs to give.
    expect(createOrder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("checkout-handoff-start"));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(HOSTED_URL));
    expect(createOrder).toHaveBeenCalledTimes(1);
    // PIX is what a hand-off store raises on the buyer's behalf: it is the one
    // method whose first charge is always raised immediately, and therefore the
    // one that always comes back with a link. Which method the buyer really
    // used is the settlement's answer, not this request's.
    expect(createOrder.mock.calls[0]?.[0]).toMatchObject({ method: "PIX" });
  });

  it("shows ONE busy state while the charge is raised, not two", async () => {
    // The screen renders its own "Preparando o pagamento", so the shell's
    // generic spinner is suppressed for this flow — stacked side by side they
    // were two spinners telling the buyer the same thing.
    const createOrder = vi.fn(handsOver());
    renderHandOff({ createOrder });

    fireEvent.click(await screen.findByTestId("checkout-handoff-start"));

    await waitFor(() => expect(screen.getByTestId("checkout-handoff-pending")).toBeTruthy());
    expect(screen.queryAllByTestId("payment-generating")).toHaveLength(0);
  });

  it("promises only the methods the store actually takes", async () => {
    renderHandOff({
      createOrder: vi.fn(handsOver()),
      config: { ...hostedStore({ methods: ["CARD"] }), methods: ["CARD"] },
    });

    const invite = await screen.findByTestId("checkout-handoff-invite");
    expect(invite.textContent).toContain("cartão");
    expect(invite.textContent).not.toContain("PIX");
  });

  it("describes the destination without naming it when the host published no name", async () => {
    // A host one release behind serves no `displayName`. The sentence has to
    // stay true rather than fall back to our internal id.
    renderHandOff({
      createOrder: vi.fn(handsOver()),
      config: hostedStore({ displayName: undefined }),
    });

    const invite = await screen.findByTestId("checkout-handoff-invite");
    expect(invite.textContent).toContain("página de pagamento segura do provedor");
    expect(invite.textContent).not.toContain("infinitepay");
  });

  it("still shows the picker for a store that collects on OUR page", async () => {
    const onPage: CheckoutProviderConfig = {
      provider: "pagbank",
      tokenization: "PUBLIC_KEY",
      publicKey: "pk_test",
      mockTokenization: false,
      methods: ["PIX", "CARD"],
      chain: [
        {
          provider: "pagbank",
          displayName: "PagBank",
          tokenization: "PUBLIC_KEY",
          publicKey: "pk_test",
          mockTokenization: false,
          methods: ["PIX", "CARD"],
          checkoutScreen: "pix-and-card",
          customerSchema: [],
        },
      ],
    };
    renderHandOff({
      createOrder: vi.fn(handsOver()),
      config: onPage,
    });

    await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());
    expect(screen.queryAllByTestId("checkout-handoff-invite")).toHaveLength(0);
  });
});
