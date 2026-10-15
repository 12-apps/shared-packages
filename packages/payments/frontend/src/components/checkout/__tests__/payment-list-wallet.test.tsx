// @vitest-environment jsdom
/**
 * FUT-3592 #4 and the card path's key — the two charges the list runs after
 * its button that need something from outside the page first.
 *
 *  - Google Pay is a row of its own, offered only where the chain head
 *    declares it and the browser's `isReadyToPay` says yes; "Pagar com Google
 *    Pay" raises the order and opens Google's own sheet straight away. Closing
 *    the sheet sends nothing more.
 *  - A store whose card key is minted per order (PagBank with no key in its
 *    config) is charged only once that key has arrived — the list's charge
 *    starts the moment the bar fills, not after a minute of typing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CheckoutProviderConfig, CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;

function walletStore(): CheckoutProviderConfig {
  const base = onPageStore();
  const head = base.chain?.[0];
  if (!head) throw new Error("the store has a chain head");
  return { ...base, chain: [{ ...head, wallets: ["GOOGLE_PAY"], googlePay: { gateway: "pagbank", gatewayMerchantId: "MID_1" } }] };
}

/** Google's `google.payments.api`, installed the way pay.js would. */
function installGoogle(load: () => Promise<unknown>) {
  const loadPaymentData = vi.fn(load);
  class PaymentsClient {
    isReadyToPay = async () => ({ result: true });
    // Google's own button: a press calls the onClick it was built with.
    createButton = ({ onClick }: { onClick: () => void }) => {
      const button = document.createElement("button");
      button.setAttribute("data-testid", "google-pay-native");
      button.addEventListener("click", onClick);
      return button;
    };
    loadPaymentData = loadPaymentData;
  }
  (window as { google?: unknown }).google = { payments: { api: { PaymentsClient } } };
  return loadPaymentData;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  delete (window as { google?: unknown }).google;
  vi.useRealTimers();
  cleanup();
});

const createOrder = () => vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));

describe("Google Pay in the list", () => {
  it("is a row only where the browser can pay with it", async () => {
    renderList({ config: walletStore(), client: stubClient(), list: { totalCents: 2700 } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-option-GOOGLE_PAY")).toBeNull());
  });

  it("is no row when the host gives no price for the sheet", async () => {
    installGoogle(async () => ({ paymentMethodData: { tokenizationData: { token: "k" } } }));
    renderList({ config: walletStore(), client: stubClient() });
    await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(screen.queryByTestId("list-option-GOOGLE_PAY")).toBeNull());
  });

  it("puts Google's own button in the bar, opens the sheet INSIDE the press, then charges its key", async () => {
    const load = installGoogle(async () => ({ paymentMethodData: { tokenizationData: { token: "gpay-key" } } }));
    const client = stubClient();
    client.chargeWallet.mockResolvedValue({ ok: true, data: { status: "PAID" } });
    const raise = createOrder();
    renderList({ config: walletStore(), client, createOrder: raise, list: { totalCents: 2700 } });
    await screen.findByTestId("list-option-GOOGLE_PAY");
    expect(screen.getByTestId("list-option-GOOGLE_PAY").textContent).toContain("Com o cartão salvo no seu Google");
    fireEvent.click(radio("list-option-GOOGLE_PAY"));
    const native = await screen.findByTestId("google-pay-native");
    fireEvent.click(native);
    // Synchronously, in the press: the browser opens a sheet only inside the tap.
    expect(load).toHaveBeenCalledTimes(1);
    expect((load.mock.calls as unknown as [Record<string, unknown>][])[0]?.[0]).toMatchObject({ transactionInfo: { totalPrice: "27.00" } });
    await waitFor(() => expect(client.chargeWallet).toHaveBeenCalledTimes(1));
    expect(raise).toHaveBeenCalledWith(expect.objectContaining({ method: "CARD" }));
    expect(client.chargeWallet).toHaveBeenCalledWith(expect.objectContaining({ orderId: "o-card", wallet: { type: "GOOGLE_PAY", key: "gpay-key" } }));
    await screen.findByTestId("payment-status");
  });

  it("refuses to charge a key whose sheet showed another amount than the order", async () => {
    installGoogle(async () => ({ paymentMethodData: { tokenizationData: { token: "gpay-key" } } }));
    const client = stubClient();
    renderList({ config: walletStore(), client, createOrder: createOrder(), list: { totalCents: 2500 } });
    await screen.findByTestId("list-option-GOOGLE_PAY");
    fireEvent.click(radio("list-option-GOOGLE_PAY"));
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    await screen.findByText(/^Não foi possível concluir o pagamento com o Google Pay/);
    expect(client.chargeWallet).not.toHaveBeenCalled();
  });

  it("sends nothing more when the buyer closes the sheet, and the list is back", async () => {
    installGoogle(async () => Promise.reject(Object.assign(new Error("closed"), { statusCode: "CANCELED" })));
    const client = stubClient();
    renderList({ config: walletStore(), client, createOrder: createOrder(), list: { totalCents: 2700 } });
    await screen.findByTestId("list-option-GOOGLE_PAY");
    fireEvent.click(radio("list-option-GOOGLE_PAY"));
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    await screen.findByTestId("google-pay-native");
    expect(client.chargeWallet).not.toHaveBeenCalled();
    expect(radio("list-option-GOOGLE_PAY").checked).toBe(true);
  });
});

describe("a card key minted per order", () => {
  it("charges only once the order's key has arrived", async () => {
    const base = onPageStore();
    const head = base.chain?.[0];
    if (!head) throw new Error("the store has a chain head");
    const pagbank: CheckoutProviderConfig = { ...base, provider: "pagbank", mockTokenization: false, chain: [{ ...head, provider: "pagbank", mockTokenization: false }] };
    const client = stubClient([SAVED_VISA]);
    const answers: ((value: { ok: true; data: { publicKey: string } }) => void)[] = [];
    const keyAnswer = new Promise<{ ok: true; data: { publicKey: string } }>((resolve) => answers.push(resolve));
    client.refreshBrowserKey.mockReturnValue(keyAnswer);
    renderList({ config: pagbank, client, createOrder: createOrder() });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(client.refreshBrowserKey).toHaveBeenCalledWith({ orderId: "o-card" }));
    expect(client.charge).not.toHaveBeenCalled();
    await act(async () => answers[0]?.({ ok: true, data: { publicKey: "pk_order" } }));
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
  });
});
