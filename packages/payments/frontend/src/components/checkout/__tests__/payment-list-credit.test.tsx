// @vitest-environment jsdom
/**
 * FUT-3591/3592, the host's code review of the one list:
 *
 *  - a saved-card list that answers `null` (or nothing) is an empty list, not
 *    a crash (P1);
 *  - Google Pay's sheet is priced with the amount DUE — the host's price after
 *    a balance it holds — and the key is charged only when the raised order
 *    asks the provider for that same amount; a host that gives no price, or a
 *    price of zero, has no Google Pay row, and a choice of it is dropped rather
 *    than left on a spinning, disabled button (P2);
 *  - `amountDueLabel` is what the card button and the 5-second bar name while an
 *    online option is chosen; a door option and an empty choice keep the
 *    cart's amount; a balance that covers everything names no card (P3);
 *  - with several saved cards, the one used LAST is preselected (P4);
 *  - a field focused inside a chosen row draws one ring, its own — the row's
 *    ring is the radio's alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CheckoutProviderConfig, CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_MASTER, SAVED_VISA, listFlow, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;

function walletStore(): CheckoutProviderConfig {
  const base = onPageStore();
  const head = base.chain?.[0];
  if (!head) throw new Error("the store has a chain head");
  return { ...base, chain: [{ ...head, wallets: ["GOOGLE_PAY"], googlePay: { gateway: "pagbank", gatewayMerchantId: "MID_1" } }] };
}

function installGoogle(token = "gpay-key") {
  const loadPaymentData = vi.fn(async () => ({ paymentMethodData: { tokenizationData: { token } } }));
  class PaymentsClient {
    isReadyToPay = async () => ({ result: true });
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

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  delete (window as { google?: unknown }).google;
  vi.useRealTimers();
  cleanup();
});

describe("a saved-card list that answers nothing", () => {
  it.each([null, undefined])("is an empty list when the wire answers %s", async (answer) => {
    const client = stubClient();
    client.listInstruments.mockResolvedValue(answer as unknown as never[]);
    renderList({ config: onPageStore(), client });
    const card = await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(card.textContent).toContain("Digite os dados do cartão"));
    expect(radio("list-option-CARD").checked).toBe(false);
  });
});

describe("Google Pay priced with the amount due", () => {
  it("prices the sheet with the host's amount due and charges when the order asks the same", async () => {
    const load = installGoogle();
    const client = stubClient();
    client.chargeWallet.mockResolvedValue({ ok: true, data: { status: "PAID" } });
    // The cart costs R$ 27,00; R$ 5,00 of the buyer's balance pays the rest.
    const raise = vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({
      ok: true,
      data: orderFor(input.method, { amountDueCents: 2200 }),
    }));
    renderList({ config: walletStore(), client, createOrder: raise, list: { totalCents: 2200, amountDueLabel: "R$ 22,00" } });
    await screen.findByTestId("list-option-GOOGLE_PAY");
    fireEvent.click(radio("list-option-GOOGLE_PAY"));
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    expect((load.mock.calls as unknown as [Record<string, unknown>][])[0]?.[0]).toMatchObject({ transactionInfo: { totalPrice: "22.00" } });
    await waitFor(() => expect(client.chargeWallet).toHaveBeenCalledTimes(1));
  });

  it("refuses the key when the raised order asks the provider for another amount than the sheet showed", async () => {
    installGoogle();
    const client = stubClient();
    // The balance moved at another till: the order claims less credit than the preview.
    const raise = vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({
      ok: true,
      data: orderFor(input.method, { amountDueCents: 2500 }),
    }));
    renderList({ config: walletStore(), client, createOrder: raise, list: { totalCents: 2200, amountDueLabel: "R$ 22,00" } });
    await screen.findByTestId("list-option-GOOGLE_PAY");
    fireEvent.click(radio("list-option-GOOGLE_PAY"));
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    await screen.findByText(/^Não foi possível concluir o pagamento com o Google Pay/);
    expect(client.chargeWallet).not.toHaveBeenCalled();
  });

  it("refuses an order with no amount due whose total is not the sheet's (the credit was applied to the order)", async () => {
    installGoogle();
    const client = stubClient();
    renderList({ config: walletStore(), client, list: { totalCents: 2200, amountDueLabel: "R$ 22,00" } });
    await screen.findByTestId("list-option-GOOGLE_PAY");
    fireEvent.click(radio("list-option-GOOGLE_PAY"));
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    await screen.findByText(/^Não foi possível concluir o pagamento com o Google Pay/);
    expect(client.chargeWallet).not.toHaveBeenCalled();
  });

  it("has no row when the whole amount is covered (a sheet of zero)", async () => {
    installGoogle();
    renderList({ config: walletStore(), client: stubClient(), list: { totalCents: 0, amountDueLabel: "R$ 0,00" } });
    await screen.findByTestId("list-option-CARD");
    await waitFor(() => expect(screen.queryByTestId("list-option-GOOGLE_PAY")).toBeNull());
  });

  it("withdraws the row when the host stops pricing it, and never leaves a spinning button", async () => {
    installGoogle();
    const host = { config: walletStore(), client: stubClient() };
    const { rerender } = renderList({ ...host, list: { totalCents: 2700 } });
    await screen.findByTestId("list-option-GOOGLE_PAY");
    fireEvent.click(radio("list-option-GOOGLE_PAY"));
    await screen.findByTestId("google-pay-native");

    rerender(listFlow({ ...host, list: {} }));
    await waitFor(() => {
      expect(screen.queryByTestId("list-option-GOOGLE_PAY")).toBeNull();
      expect(payButton().querySelector('[role="progressbar"]')).toBeNull();
      expect(screen.getByText("Escolha como pagar.")).toBeTruthy();
    });

    rerender(listFlow({ ...host, list: { totalCents: 2500 } }));
    await screen.findByTestId("list-option-GOOGLE_PAY");
  });
});

describe("the amount due on the bar", () => {
  it("names the amount due on the card's button and in the 5-second bar", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { amountDueLabel: "R$ 22,00", totalCents: 2200 } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    expect(payButton().textContent).toBe("PagarR$ 22,00");
    vi.useFakeTimers();
    fireEvent.click(payButton());
    expect(screen.getByTestId("list-charge-bar").textContent).toBe("Pagando R$ 22,00 no Visa final 4242…");
    vi.useRealTimers();
  });

  it("keeps the cart's amount for a door option, which no balance pays", async () => {
    const door: CheckoutDoorOption = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { amountDueLabel: "R$ 22,00", door: [door] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(payButton().textContent).toBe("Enviar pedidoR$ 27,00"));
  });

  it("keeps the cart's amount while nothing is chosen", async () => {
    renderList({ config: onPageStore(), client: stubClient(), list: { amountDueLabel: "R$ 22,00" } });
    await screen.findByTestId("list-option-CARD");
    expect(payButton().textContent).toBe("Escolha como pagarR$ 27,00");
  });

  it("names no card when the balance covers the whole amount", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { amountDueLabel: "R$ 0,00", totalCents: 0 } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    const bar = screen.getByTestId("list-charge-bar").textContent ?? "";
    vi.useRealTimers();
    expect(bar).toBe("Confirmando o pedido, pago com o seu saldo…");
    expect(bar).not.toContain("Visa");
  });

  it("raises again when the amount due moved under a refused card order whose total did not", async () => {
    const createOrder = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: orderFor("CARD", { amountDueCents: 2700 }) })
      .mockResolvedValueOnce({ ok: true, data: orderFor("CARD", { orderId: "o-card-2", amountDueCents: 2200 }) });
    const client = stubClient([SAVED_VISA]);
    client.charge.mockResolvedValueOnce({ ok: false, error: "Recusado.", code: "INVALID" } as never);
    const host = { config: onPageStore(), client, createOrder };
    const { rerender } = renderList({ ...host, list: { totalCents: 2700 } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await advance(CHARGE_WINDOW_MS);
    vi.useRealTimers();
    await screen.findByText("Recusado.");
    // The buyer ticks their balance: the cart still costs R$ 27,00, the charge does not.
    rerender(listFlow({ ...host, list: { totalCents: 2200, amountDueLabel: "R$ 22,00" } }));
    await waitFor(() => expect(payButton().textContent).toBe("PagarR$ 22,00"));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await advance(CHARGE_WINDOW_MS);
    vi.useRealTimers();
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(client.charge).toHaveBeenLastCalledWith(expect.objectContaining({ orderId: "o-card-2" })));
  });
});

describe("the card used last", () => {
  it("is preselected over a newer card used earlier, and chosen again on the way back", async () => {
    const older = { ...SAVED_VISA, lastUsedAt: "2026-10-01T10:00:00.000Z" };
    const lastUsed = { ...SAVED_MASTER, lastUsedAt: "2026-10-14T10:00:00.000Z" };
    const door: CheckoutDoorOption = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
    renderList({ config: onPageStore(), client: stubClient([older, lastUsed]), list: { door: [door] } });
    await waitFor(() => expect(screen.getByTestId("list-card-vault-2").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(radio("list-door-cash"));
    fireEvent.click(radio("list-option-CARD"));
    await waitFor(() => expect(screen.getByTestId("list-card-vault-2").getAttribute("aria-checked")).toBe("true"));
  });

  it("falls back to the list's head when no card says when it was used", async () => {
    const used = { ...SAVED_MASTER, lastUsedAt: null };
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA, used]) });
    await waitFor(() => expect(screen.getByTestId("list-card-vault-1").getAttribute("aria-checked")).toBe("true"));
  });
});

describe("the row's focus ring", () => {
  it("is drawn for the row's own radio only, never for a field opened inside it", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
    await screen.findByTestId("list-option-CARD");
    const css = Array.from(document.querySelectorAll("style"), (style) => style.textContent ?? "").join("\n");
    const rings = css.match(/:has\([^{]*focus-visible\)/g) ?? [];
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(ring).toContain("input[type='radio']");
  });
});
