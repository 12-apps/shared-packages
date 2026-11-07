// @vitest-environment jsdom
/**
 * FUT-4416, review round 1 — an order raised from a priced list says WHICH
 * price it is for (`CreateOrderRequest.pricedAs`): the Pix row, the card, the
 * debit card, or a wallet's sheet — so the host prices the order the way the
 * buyer is about to pay. And a fresh card order that does not ask the chosen
 * row's cents is never charged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CheckoutListPrices } from "../list/types";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, installGoogle, listFlow, onPageStore, orderFor, renderList, stubClient, uninstallWallets, walletStore } from "./list-harness";

const PRICES: CheckoutListPrices = {
  online: {
    PIX: { amountLabel: "R$ 25,00", amountCents: 2500 },
    CARD: { amountLabel: "R$ 27,00", amountCents: 2700 },
    CARD_DEBIT: { amountLabel: "R$ 26,00", amountCents: 2600 },
  },
  wallets: { amountLabel: "R$ 27,00", amountCents: 2700 },
};

const ADDRESS = { street: "Av. Brigadeiro Faria Lima", number: "1384", city: "São Paulo", regionCode: "SP", postalCode: "01452-002" };

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;

function raiseAt(cents: number) {
  return vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method, { totalCents: cents, amountDueCents: cents }) }));
}

async function pressCardAndWait(): Promise<void> {
  vi.useFakeTimers();
  fireEvent.click(screen.getByTestId("list-pay"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
  });
  vi.useRealTimers();
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  uninstallWallets();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe("the raise names the priced choice", () => {
  it("Pix raises as PIX", async () => {
    const raise = raiseAt(2500);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder: raise, list: { prices: PRICES, lastMethod: "PIX" } });
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(true));
    fireEvent.click(screen.getByTestId("list-pay"));
    await waitFor(() => expect(raise).toHaveBeenCalledWith(expect.objectContaining({ method: "PIX", pricedAs: "PIX" })));
  });

  it("the saved card raises as CARD", async () => {
    const raise = raiseAt(2700);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder: raise, list: { prices: PRICES } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await pressCardAndWait();
    await waitFor(() => expect(raise).toHaveBeenCalledWith(expect.objectContaining({ method: "CARD", pricedAs: "CARD" })));
  });

  it("Google Pay pressed while the debit card is chosen raises as WALLET, at the wallets' price", async () => {
    const { loadPaymentData } = installGoogle();
    const head = walletStore().chain![0]!;
    const config = { ...walletStore(), chain: [{ ...head, debit: true }] };
    const client = { ...stubClient([SAVED_VISA]), threeDSecureSession: vi.fn() };
    client.chargeWallet.mockResolvedValue({ ok: true, data: { status: "PAID" } });
    const raise = raiseAt(2700);
    renderList({ config, client, createOrder: raise, list: { prices: PRICES, totalCents: 2600, billingAddress: ADDRESS } });
    fireEvent.click(await screen.findByTestId("list-option-CARD-DEBIT-radio"));
    await waitFor(() => expect(radio("list-option-CARD-DEBIT").checked).toBe(true));
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    expect((loadPaymentData.mock.calls as unknown as [Record<string, unknown>][])[0]?.[0]).toMatchObject({ transactionInfo: { totalPrice: "27.00" } });
    await waitFor(() => expect(raise).toHaveBeenCalledWith(expect.objectContaining({ method: "CARD", pricedAs: "WALLET" })));
    await waitFor(() => expect(client.chargeWallet).toHaveBeenCalledTimes(1));
  });

  it("an unpriced list raises exactly as before: no pricedAs", async () => {
    const raise = raiseAt(2700);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder: raise, list: { lastMethod: "PIX" } });
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(true));
    fireEvent.click(screen.getByTestId("list-pay"));
    await waitFor(() => expect(raise).toHaveBeenCalledTimes(1));
    expect(raise.mock.calls[0]![0]).not.toHaveProperty("pricedAs");
  });
});

describe("a fresh card order is checked against the chosen row", () => {
  it("is never charged when it asks other cents than the row's, and the list is back", async () => {
    const client = stubClient([SAVED_VISA]);
    renderList({ config: onPageStore(), client, createOrder: raiseAt(9999), list: { prices: PRICES } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await pressCardAndWait();
    await waitFor(() => expect(screen.getByTestId("list-pay")).toBeTruthy());
    expect(client.charge).not.toHaveBeenCalled();
  });

  it("is charged when it asks the row's cents", async () => {
    const client = stubClient([SAVED_VISA]);
    renderList({ config: onPageStore(), client, createOrder: raiseAt(2700), list: { prices: PRICES } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await pressCardAndWait();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
  });
});

/**
 * Review round 2: the chosen row's cents are frozen at the press. A host that
 * re-prices the row while the charge is out (3DS, the AWAITING wait) never
 * turns that charge into a failure and never brings the button back over it:
 * a second press would charge twice.
 */
describe("a re-price while the card charge is out", () => {
  const REPRICED: CheckoutListPrices = { ...PRICES, online: { ...PRICES.online, CARD: { amountLabel: "R$ 26,00", amountCents: 2600 } } };

  async function pressThenReprice(client: ReturnType<typeof stubClient>): Promise<void> {
    const host = { config: onPageStore(), client, createOrder: raiseAt(2700), list: { prices: PRICES } };
    const { rerender } = renderList(host);
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await pressCardAndWait();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
    // `rerender` runs in `act`: every effect the re-price triggers, and the
    // renders those effects cause, have run when it returns.
    rerender(listFlow({ ...host, list: { prices: REPRICED } }));
  }

  it("a charge still being answered says no failure and shows no button", async () => {
    const client = stubClient([SAVED_VISA]);
    client.charge.mockImplementation(() => new Promise(() => undefined) as never);
    await pressThenReprice(client);
    expect(screen.queryAllByText("Não foi possível pagar")).toHaveLength(0);
    expect(screen.queryAllByTestId("list-pay")).toHaveLength(0);
    expect(client.charge).toHaveBeenCalledTimes(1);
  });

  it("a charge accepted and awaited says no failure and shows no button", async () => {
    const client = stubClient([SAVED_VISA]);
    client.charge.mockResolvedValue({ ok: true, data: { status: "AWAITING_PAYMENT" } } as never);
    await pressThenReprice(client);
    expect(screen.queryAllByText("Não foi possível pagar")).toHaveLength(0);
    expect(screen.queryAllByTestId("list-pay")).toHaveLength(0);
    expect(client.charge).toHaveBeenCalledTimes(1);
  });
});
