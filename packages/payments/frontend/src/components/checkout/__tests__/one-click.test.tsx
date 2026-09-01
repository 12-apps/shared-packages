// @vitest-environment jsdom
/**
 * ONE-CLICK checkout (FUT-1070) — a buyer who pressed BUY has already paid,
 * or has not.
 *
 * The storefront's "Pedir de novo" sheet grew a **Comprar** button beside its
 * add-to-cart: press it and the shopper expects the purchase to be done, the
 * way Amazon's own one-click reads. What arrives here is a REQUEST for that,
 * and this suite is about the two directions it can go — because the failure
 * modes are not symmetric. Standing down costs a buyer the taps they would
 * have made anyway; arming wrongly charges a card nobody chose.
 *
 * So both halves are pinned, and the stand-downs outnumber the happy path
 * deliberately: no CPF on file, no saved card, a store that finishes on the
 * provider's own page, and a decline that must not be retried. Each of those
 * has to land the buyer on the ORDINARY flow with nothing charged — the same
 * screens they would have got had the parameter never been sent.
 *
 * The client is mocked at `../client`, which is the module the unbound
 * checkout client is built from, so these drive the real hooks, the real
 * controller and the real card path against a stubbed wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  chargeCard: vi.fn(),
  chargeWallet: vi.fn(),
  fetchCheckoutConfig: vi.fn(),
  listSavedCards: vi.fn(),
  pollOrderStatus: vi.fn(),
  refreshCardPublicKey: vi.fn(),
}));

vi.mock("../client", () => client);

import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { CheckoutFlow } from "../checkout-flow";
import { CheckoutNavigateProvider } from "../navigate-context";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import type {
  CheckoutOrder,
  CheckoutProviderConfig,
  CreateOrderRequest,
  CreateOrderResult,
} from "../types";

/** A card order, as the host's `createOrder` port answers it. */
const CARD_ORDER: CheckoutOrder = {
  orderId: "o-oneclick",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 1400,
  subtotalCents: 1400,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 14,00",
};

/** The card this buyer already has on file at this store. */
const SAVED_CARD = {
  id: "vault-1",
  brand: "visa",
  last4: "4242",
  expMonth: 11,
  expYear: 2032,
  holder: "THOMPSON L",
};

/** A store that takes the card on OUR page — the shape one-click can honour. */
function pagbankStore(): CheckoutProviderConfig {
  return {
    provider: "pagbank",
    tokenization: "PUBLIC_KEY",
    publicKey: "pk_live_1",
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "pagbank",
        displayName: "PagBank",
        tokenization: "PUBLIC_KEY",
        publicKey: "pk_live_1",
        mockTokenization: false,
        methods: ["PIX", "CARD"],
        checkoutScreen: "pix-and-card",
        customerSchema: [],
      },
    ],
  };
}

/** A store that finishes on the provider's own page — InfinitePay's shape. */
function hostedStore(): CheckoutProviderConfig {
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
        customerSchema: [],
      },
    ],
  };
}

function renderCheckout(options: {
  oneClick?: boolean;
  taxIdOnFile?: boolean;
  /** `null` states the protocol is still unknown; absent takes the default. */
  config?: CheckoutProviderConfig | null;
  createOrder?: (input: CreateOrderRequest) => Promise<CreateOrderResult>;
}): { createOrder: ReturnType<typeof vi.fn> } {
  // `in` rather than `??`, so a deliberate `null` stays null: the still-loading
  // case is exactly the one a default would hide.
  const config = "config" in options ? options.config : pagbankStore();
  const createOrder = vi.fn(
    options.createOrder ?? (async (): Promise<CreateOrderResult> => ({ ok: true, data: CARD_ORDER })),
  );
  render(
    <CheckoutNavigateProvider navigate={vi.fn()}>
      <CheckoutFlow
        copy={PT_BR_CHECKOUT_VIEW_COPY}
        cart={{ empty: false, totalLabel: "R$ 14,00", totalItems: 1 }}
        createOrder={createOrder}
        onExitToMenu={vi.fn()}
        providerConfig={config}
        taxIdOnFile={options.taxIdOnFile ?? true}
        tenantSlug="future-drink"
        oneClick={options.oneClick ?? true}
      />
    </CheckoutNavigateProvider>,
  );
  return { createOrder };
}

/** Every stand-down asserts the same thing: nobody was charged. */
function nothingCharged(): void {
  expect(client.chargeCard).not.toHaveBeenCalled();
}

beforeEach(() => {
  window.sessionStorage.clear();
  for (const spy of Object.values(client)) spy.mockReset();
  client.listSavedCards.mockResolvedValue([]);
  client.chargeCard.mockResolvedValue({ ok: true, data: { status: "PAID" } });
  client.pollOrderStatus.mockResolvedValue({ ok: true, data: "PAID" });
  client.refreshCardPublicKey.mockResolvedValue({ ok: true, data: { publicKey: null } });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("one-click checkout — the buyer who pressed Comprar", () => {
  it("charges the saved card and lands on Confirmação, with no tap", async () => {
    client.listSavedCards.mockResolvedValue([SAVED_CARD]);

    const { createOrder } = renderCheckout({});

    // The whole feature, in one assertion: a card order was raised and the
    // buyer's own vault token was charged, with nothing clicked.
    await waitFor(() => expect(client.chargeCard).toHaveBeenCalledTimes(1));
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0]?.[0]).toMatchObject({ method: "CARD" });
    expect(client.chargeCard.mock.calls[0]?.[0]).toMatchObject({
      orderId: CARD_ORDER.orderId,
      token: SAVED_CARD.id,
    });
    // Step 3 — "Compra confirmada". The status screen is the terminal one, and
    // reaching it without an interaction is what "one click" means.
    expect(await screen.findByTestId("payment-receipt")).toBeTruthy();
  });

  it("leaves a buyer with NO saved card on the ordinary Pagamento step", async () => {
    const { createOrder } = renderCheckout({});

    // The card tile is still taken — the buyer asked to buy — so the order is
    // raised and the form is on screen. What does NOT happen is a charge.
    await waitFor(() => expect(screen.getByTestId("card-view")).toBeTruthy());
    expect(createOrder).toHaveBeenCalledTimes(1);
    // The picker is still there, so PIX remains one tap away: this is step 2,
    // not a dead end.
    expect(screen.getByTestId("checkout-method")).toBeTruthy();
    expect(screen.getByTestId("card-pay")).toBeTruthy();
    nothingCharged();
  });

  it("stands down for a store that finishes on the provider's page", async () => {
    client.listSavedCards.mockResolvedValue([SAVED_CARD]);

    const { createOrder } = renderCheckout({ config: hostedStore() });

    // The hand-off invite is the ordinary screen for this store, and its
    // button is the buyer's consent to LEAVE — never ours to press.
    await waitFor(() => expect(screen.getByTestId("checkout-handoff-start")).toBeTruthy());
    expect(createOrder).not.toHaveBeenCalled();
    nothingCharged();
  });

  it("stands down for a buyer with no CPF on file — Dados is still theirs to fill", async () => {
    client.listSavedCards.mockResolvedValue([SAVED_CARD]);

    const { createOrder } = renderCheckout({ taxIdOnFile: false });

    await waitFor(() => expect(screen.getByTestId("checkout-continue")).toBeTruthy());
    expect(createOrder).not.toHaveBeenCalled();
    nothingCharged();
  });

  it("stands down while the store's protocol is still unknown", async () => {
    client.listSavedCards.mockResolvedValue([SAVED_CARD]);

    const { createOrder } = renderCheckout({ config: null });

    await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());
    expect(createOrder).not.toHaveBeenCalled();
    nothingCharged();
  });

  it("changes nothing for an ordinary checkout the buyer opened themselves", async () => {
    client.listSavedCards.mockResolvedValue([SAVED_CARD]);

    const { createOrder } = renderCheckout({ oneClick: false });

    await waitFor(() => expect(screen.getByTestId("checkout-method")).toBeTruthy());
    expect(createOrder).not.toHaveBeenCalled();
    nothingCharged();
  });

  it("does not retry a declined card — the buyer gets the refusal and the button", async () => {
    client.listSavedCards.mockResolvedValue([SAVED_CARD]);
    client.chargeCard.mockResolvedValue({ ok: false, error: "Cartão recusado.", code: "DECLINED" });

    renderCheckout({});

    await waitFor(() => expect(screen.getByTestId("card-error")).toBeTruthy());
    // The one automatic attempt, and only that one: three identical declines
    // nobody asked for is the shape this guard exists to refuse.
    expect(client.chargeCard).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("card-pay")).toBeTruthy();
  });
});
