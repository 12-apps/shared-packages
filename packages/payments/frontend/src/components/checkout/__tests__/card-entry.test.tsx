// @vitest-environment jsdom
/**
 * FUT-3811 — `screens.CardEntry`: the one list's card for a payable that
 * already exists (a host's "pay this order with a card"), which replaced the
 * tabbed checkout's card view.
 *
 *  - A buyer with a saved card lands on it, and "Pagar" charges it.
 *  - A new card is checked field by field before anything is minted, then
 *    charged once, on the list's own runner.
 *  - An accepted charge gives way to the wait; a refusal brings the buyer back
 *    to the card as they left it.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const client = vi.hoisted(() => ({
  chargeCard: vi.fn(),
  listSavedCards: vi.fn(),
  refreshCardPublicKey: vi.fn(),
  pollOrderStatus: vi.fn(),
  fetchCheckoutConfig: vi.fn(),
}));

vi.mock("../client", () => client);

import { CardEntryPane } from "../list/card-entry";
import type { CheckoutOrder, CheckoutProviderConfig } from "../types";

const ORDER: CheckoutOrder = {
  orderId: "o1",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 1250,
  subtotalCents: 1250,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 12,50",
};

const CONFIG: CheckoutProviderConfig = {
  provider: "pagbank",
  tokenization: "PUBLIC_KEY",
  publicKey: null,
  mockTokenization: true,
  methods: ["CARD"],
  chain: [{ provider: "pagbank", tokenization: "PUBLIC_KEY", publicKey: null, mockTokenization: true, methods: ["CARD"] }],
};

const SAVED = { id: "card_1", brand: "visa", last4: "1111", expMonth: 12, expYear: 2034, holder: "VERA CADEIA" };

const pay = (): void => {
  fireEvent.click(screen.getByTestId("card-pay-bar").querySelector("button") as HTMLElement);
};
const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

beforeEach(() => {
  vi.clearAllMocks();
  client.listSavedCards.mockResolvedValue([]);
  client.refreshCardPublicKey.mockResolvedValue({ ok: true, data: { publicKey: null } });
  client.pollOrderStatus.mockResolvedValue({ ok: true, data: "AWAITING_PAYMENT" });
  client.chargeCard.mockResolvedValue({ ok: true, data: { status: "AWAITING_PAYMENT" } });
});

afterEach(() => {
  cleanup();
});

describe("the card entry for an existing payable", () => {
  it("lands on the buyer's saved card and charges it", async () => {
    client.listSavedCards.mockResolvedValue([SAVED]);
    render(<CardEntryPane order={ORDER} config={CONFIG} onResolved={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId("saved-cards")).toBeTruthy());
    expect(screen.getByText("Pague com cartão")).toBeTruthy();

    pay();

    await waitFor(() => expect(client.chargeCard).toHaveBeenCalledTimes(1));
    expect(client.chargeCard.mock.calls[0]?.[0]).toMatchObject({ orderId: "o1", token: "card_1" });
  });

  it("checks a new card's fields before charging anything", async () => {
    render(<CardEntryPane order={ORDER} config={CONFIG} onResolved={vi.fn()} />);
    await waitFor(() => expect(client.listSavedCards).toHaveBeenCalled());

    pay();

    await waitFor(() => expect(screen.getByText("Informe o nome impresso no cartão.")).toBeTruthy());
    expect(client.chargeCard).not.toHaveBeenCalled();
  });

  it("mints and charges a typed card once, then gives way to the wait", async () => {
    render(<CardEntryPane order={ORDER} config={CONFIG} onResolved={vi.fn()} />);
    await waitFor(() => expect(client.listSavedCards).toHaveBeenCalled());
    type("card-number", "4111 1111 1111 1111");
    type("card-holder", "VERA CADEIA");
    type("card-expiry", "12/34");
    type("card-cvv", "123");

    pay();

    await waitFor(() => expect(client.chargeCard).toHaveBeenCalledTimes(1));
    expect(client.chargeCard.mock.calls[0]?.[0]).toMatchObject({ orderId: "o1", saveCard: false });
    await waitFor(() => expect(screen.getByTestId("card-processing")).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId("card-pay-bar")).toBeNull());
  });

  it("brings a refused buyer back to the card as they left it", async () => {
    client.chargeCard.mockResolvedValue({ ok: false, error: "Cartão recusado.", code: "PAYMENT_UNAVAILABLE" });
    render(<CardEntryPane order={ORDER} config={CONFIG} onResolved={vi.fn()} />);
    await waitFor(() => expect(client.listSavedCards).toHaveBeenCalled());
    type("card-number", "4111 1111 1111 1111");
    type("card-holder", "VERA CADEIA");
    type("card-expiry", "12/34");
    type("card-cvv", "123");

    pay();

    await waitFor(() => expect(screen.getByTestId("card-error")).toBeTruthy());
    expect((screen.getByTestId("card-holder") as HTMLInputElement).value).toBe("VERA CADEIA");
    expect(screen.getByTestId("card-pay-bar")).toBeTruthy();
  });
});
