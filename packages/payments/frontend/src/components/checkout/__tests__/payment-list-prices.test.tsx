// @vitest-environment jsdom
/**
 * FUT-4416 — what each way to pay costs, as the host prices it.
 *
 * The package computes no price: the host hands each row its amount
 * (`paymentList.prices.online`, a door option's `price`), and the list draws it
 * at the row's right, names the CHOSEN one on the button and in the 5-second
 * bar, and asks the wallets' sheets for the wallets' price. With no price
 * handed over, the list is exactly today's (keep list K6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { CheckoutDoorOption, PaymentListCopy } from "../list/types";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, installGoogle, onPageStore, orderFor, renderList, stubClient, uninstallWallets, walletStore } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLElement => screen.getByTestId("list-pay");

/** The example cart of the ticket: R$ 138,70 full, Pix R$ 126,75, Dinheiro R$ 134,69. */
const ONLINE = {
  PIX: { amountLabel: "R$ 126,75", amountCents: 12675, savingLabel: "R$ 11,95", discount: { label: "Desconto no Pix", amountLabel: "−R$ 11,95" } },
  CARD: { amountLabel: "R$ 138,70", amountCents: 13870 },
};

function cash(extra: Partial<CheckoutDoorOption> = {}): CheckoutDoorOption {
  return {
    id: "cash",
    label: "Dinheiro",
    action: "Enviar pedido",
    blocked: null,
    onSend: vi.fn(),
    price: { amountLabel: "R$ 134,69", savingLabel: "R$ 4,01", discount: { label: "Desconto no dinheiro", amountLabel: "−R$ 4,01" } },
    ...extra,
  };
}

function reader(extra: Partial<CheckoutDoorOption> = {}): CheckoutDoorOption {
  return { id: "reader", label: "Maquininha", action: "Enviar pedido", blocked: null, onSend: vi.fn(), price: { amountLabel: "R$ 138,70", upTo: true, note: "Pix R$ 126,75" }, ...extra };
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  uninstallWallets();
  vi.useRealTimers();
  cleanup();
});

describe("no price handed over (K6)", () => {
  it("draws no amount, no saving line, no discount line, and the button names the cart's total", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { door: [{ ...cash(), price: undefined }] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    const list = screen.getByTestId("payment-list");
    expect(list.querySelectorAll('[data-testid$="-amount"]')).toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId("list-price-discount")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-nudges")).toBeNull());
    expect(payButton().textContent).toBe("PagarR$ 27,00");
  });
});

describe("an amount per row (E25)", () => {
  it("draws each online row's amount at its right, with the saving under it — and none under a row with no saving", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { prices: { online: ONLINE } } });
    expect((await screen.findByTestId("list-option-PIX-amount")).textContent).toBe("R$ 126,75");
    expect(screen.getByTestId("list-option-PIX-amount-note").textContent).toBe("R$ 11,95 a menos");
    expect(screen.getByTestId("list-option-CARD-amount").textContent).toBe("R$ 138,70");
    await waitFor(() => expect(screen.queryByTestId("list-option-CARD-amount-note")).toBeNull());
  });

  it("draws a door row's amount, 'até' when it depends on what is passed later, and the host's own note in place of a saving", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { door: [cash(), reader()] } });
    expect((await screen.findByTestId("list-door-cash-amount")).textContent).toBe("R$ 134,69");
    expect(screen.getByTestId("list-door-cash-amount-note").textContent).toBe("R$ 4,01 a menos");
    expect(screen.getByTestId("list-door-reader-amount").textContent).toBe("até R$ 138,70");
    expect(screen.getByTestId("list-door-reader-amount-note").textContent).toBe("Pix R$ 126,75");
  });

  it("keeps the label beside the amount, never under it — the amount does not shrink", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { prices: { online: ONLINE } } });
    const amount = await screen.findByTestId("list-option-PIX-amount");
    expect(getComputedStyle(amount).flexShrink).toBe("0");
    expect(getComputedStyle(amount).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(amount).textAlign).toBe("right");
  });

  it("ignores a price for a row the store does not offer, and leaves the rows without one bare", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { prices: { online: { HAND_OFF: { amountLabel: "R$ 1,00" }, PIX: ONLINE.PIX } } } });
    await screen.findByTestId("list-option-PIX-amount");
    await waitFor(() => expect(screen.queryByTestId("list-option-HAND_OFF")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-option-CARD-amount")).toBeNull());
  });

  it("falls back on a pack without the amounts' words: no saving line, and 'até' drawn as the plain amount", async () => {
    const copy: PaymentListCopy = { ...PT_BR_PAYMENT_LIST_COPY, amounts: undefined };
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { copy, prices: { online: ONLINE }, door: [reader()] } });
    expect((await screen.findByTestId("list-option-PIX-amount")).textContent).toBe("R$ 126,75");
    await waitFor(() => expect(screen.queryByTestId("list-option-PIX-amount-note")).toBeNull());
    expect(screen.getByTestId("list-door-reader-amount").textContent).toBe("R$ 138,70");
    expect(screen.getByTestId("list-door-reader-amount-note").textContent).toBe("Pix R$ 126,75");
  });
});

describe("the chosen way to pay names its own amount", () => {
  it("the button names the chosen row's amount, and moves with the choice", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { prices: { online: ONLINE }, lastMethod: "PIX", door: [cash()] } });
    await waitFor(() => expect(payButton().textContent).toBe("Gerar PixR$ 126,75"));
    fireEvent.click(radio("list-option-CARD"));
    await waitFor(() => expect(payButton().textContent).toBe("PagarR$ 138,70"));
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(payButton().textContent).toBe("Enviar pedidoR$ 134,69"));
  });

  it("a door row priced 'até' names 'até' on the button, and the host's own totalLabel still wins", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { door: [reader(), cash({ totalLabel: "R$ 1,00" })] } });
    fireEvent.click(await screen.findByTestId("list-door-reader-radio"));
    await waitFor(() => expect(payButton().textContent).toBe("Enviar pedidoaté R$ 138,70"));
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(payButton().textContent).toBe("Enviar pedidoR$ 1,00"));
  });

  it("the 5-second bar names the chosen card's amount", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { prices: { online: { ...ONLINE, CARD: { amountLabel: "R$ 136,03", amountCents: 13603 } } } } });
    await waitFor(() => expect(payButton().textContent).toBe("PagarR$ 136,03"));
    fireEvent.click(payButton());
    expect((await screen.findByTestId("list-charge-bar")).textContent).toBe("Pagando R$ 136,03 no Visa 4242…");
  });
});

describe("the wallets' price (E34)", () => {
  const raise = () => vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method, { amountDueCents: 13870, totalCents: 13870, totalLabel: "R$ 138,70" }) }));

  it("opens Google Pay's sheet at the wallets' price, not the chosen row's, and charges an order asking that amount", async () => {
    const { loadPaymentData } = installGoogle();
    const client = stubClient([SAVED_VISA]);
    client.chargeWallet.mockResolvedValue({ ok: true, data: { status: "PAID" } });
    renderList({ config: walletStore(), client, createOrder: raise(), list: { totalCents: 12675, lastMethod: "PIX", prices: { online: ONLINE, wallets: { amountLabel: "R$ 138,70", amountCents: 13870 } } } });
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    expect((loadPaymentData.mock.calls as unknown as [Record<string, unknown>][])[0]?.[0]).toMatchObject({ transactionInfo: { totalPrice: "138.70" } });
    await waitFor(() => expect(client.chargeWallet).toHaveBeenCalledTimes(1));
  });

  it("keeps the host's totalCents when the wallets' price carries no usable cents", async () => {
    const { loadPaymentData } = installGoogle();
    renderList({ config: walletStore(), client: stubClient(), list: { totalCents: 2700, prices: { wallets: { amountLabel: "R$ 1,00", amountCents: -100 } } } });
    fireEvent.click(await screen.findByTestId("google-pay-native"));
    expect((loadPaymentData.mock.calls as unknown as [Record<string, unknown>][])[0]?.[0]).toMatchObject({ transactionInfo: { totalPrice: "27.00" } });
  });
});
