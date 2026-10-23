// @vitest-environment jsdom
/**
 * FUT-3592 — paying without a dialog.
 *
 * The bar's button is the consent. The card's "Pagar" turns into a bar that
 * fills in five seconds with "Cancelar" under it: cancelled, NOTHING has been
 * sent — no order, no token, no charge — and the list is back as it was; not
 * cancelled, the order is raised and the card charged as today. "Gerar Pix"
 * makes the order and the code at once, and the code copies on a tap; the
 * hand-off store goes straight to its page. No dialog at any point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, handOffStore, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;

function recordingCreateOrder() {
  return vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

/** A returning buyer with a saved Visa, at the card. */
async function savedCardReady(createOrder = recordingCreateOrder()) {
  const client = stubClient([SAVED_VISA]);
  renderList({ config: onPageStore(), client, createOrder });
  await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
  return { client, createOrder };
}

describe("the card's 5-second bar", () => {
  it("turns Pagar into the bar, naming the card, with Cancelar under it — and no dialog", async () => {
    await savedCardReady();
    vi.useFakeTimers();
    fireEvent.click(payButton());
    const bar = screen.getByTestId("list-charge-bar");
    expect(bar.textContent).toBe("Pagando R$ 27,00 no Visa 4242…");
    expect(bar.getAttribute("data-full")).toBe("false");
    expect(screen.getByTestId("list-charge-cancel").textContent).toBe("Cancelar");
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByTestId("list-pay")).toBeNull());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("locks the list while the bar counts — only Cancelar acts — and hides the credit and payer lines", async () => {
    const createOrder = recordingCreateOrder();
    const client = stubClient([SAVED_VISA]);
    renderList({ config: onPageStore(), client, createOrder, list: { onlineExtras: <span data-testid="credit">crédito</span> } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    expect(screen.getByTestId("credit")).toBeTruthy();
    vi.useFakeTimers();
    fireEvent.click(payButton());
    const list = screen.getByTestId("payment-list");
    expect(list.getAttribute("data-locked")).toBe("true");
    expect(list.hasAttribute("inert")).toBe(true);
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByTestId("credit")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-payer")).toBeNull());
    fireEvent.click(screen.getByTestId("list-charge-cancel"));
    await waitFor(() => expect(screen.getByTestId("payment-list").getAttribute("data-locked")).toBe("false"));
    expect(screen.getByTestId("credit")).toBeTruthy();
  });

  it("names a card typed now as 'o cartão informado'", async () => {
    await savedCardReady();
    fireEvent.click(screen.getByTestId("list-card-new"));
    fireEvent.change(screen.getByTestId("card-number"), { target: { value: "4111 1111 1111 1111" } });
    fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA TESTE" } });
    fireEvent.change(screen.getByTestId("card-expiry"), { target: { value: "12/40" } });
    fireEvent.change(screen.getByTestId("card-cvv"), { target: { value: "123" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    expect(screen.getByTestId("list-charge-bar").textContent).toBe("Pagando R$ 27,00 no cartão informado…");
  });

  it("sends NOTHING when Cancelar is pressed inside the window, and the list is as it was", async () => {
    const { client, createOrder } = await savedCardReady();
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS - 1);
    });
    fireEvent.click(screen.getByTestId("list-charge-cancel"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS * 3);
    });
    vi.useRealTimers();
    expect(createOrder).not.toHaveBeenCalled();
    expect(client.charge).not.toHaveBeenCalled();
    expect(client.refreshBrowserKey).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("list-charge-bar")).toBeNull());
    expect(radio("list-option-CARD").checked).toBe(true);
    expect(screen.getByTestId("list-card-vault-1").getAttribute("aria-checked")).toBe("true");
    expect(payButton().disabled).toBe(false);
  });

  it("raises the order and charges the saved card when the bar fills untouched", async () => {
    const { client, createOrder } = await savedCardReady();
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS - 1);
    });
    expect(createOrder).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    vi.useRealTimers();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ method: "CARD" }));
    expect(client.charge).toHaveBeenCalledWith(expect.objectContaining({ orderId: "o-card", token: "vault-1" }));
    await screen.findByTestId("payment-status");
  });

  it("charges a card typed now with the instrument minted for it", async () => {
    const { client } = await savedCardReady();
    fireEvent.click(screen.getByTestId("list-card-new"));
    fireEvent.change(screen.getByTestId("card-number"), { target: { value: "4111 1111 1111 1111" } });
    fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA TESTE" } });
    fireEvent.change(screen.getByTestId("card-expiry"), { target: { value: "12/40" } });
    fireEvent.change(screen.getByTestId("card-cvv"), { target: { value: "123" } });
    await waitFor(() => expect(payButton().disabled).toBe(false));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(1));
    const [input] = client.charge.mock.calls[0] as unknown as [{ token: string }];
    expect(input.token).not.toBe("vault-1");
  });

  it("goes back to the list, saying why, when the order cannot be raised", async () => {
    const createOrder = vi.fn(async (): Promise<CreateOrderResult> => ({
      ok: false,
      error: { code: "STORE_CLOSED", message: "A loja fechou.", field: null },
    }));
    const { client } = await savedCardReady(createOrder);
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await screen.findByText("A loja fechou.");
    expect(client.charge).not.toHaveBeenCalled();
    expect(payButton().disabled).toBe(false);
  });

  it("shows the refusal beside the card, and keeps Pagar, when the charge is refused", async () => {
    const { client } = await savedCardReady();
    client.charge.mockResolvedValueOnce({ ok: false, error: "Cartão recusado pelo emissor.", code: "INVALID" } as never);
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHARGE_WINDOW_MS);
    });
    vi.useRealTimers();
    await screen.findByText("Cartão recusado pelo emissor.");
    expect(payButton().disabled).toBe(false);
  });
});

describe("Pix, straight away", () => {
  async function pixRaised() {
    const createOrder = recordingCreateOrder();
    const client = stubClient([]);
    renderList({ config: onPageStore(), client, createOrder, list: { summary: "2 itens · Entrega grátis" } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    expect(payButton().textContent).toBe("Gerar PixR$ 27,00");
    fireEvent.click(payButton());
    await screen.findByTestId("list-pix");
    return { createOrder };
  }

  it("makes the order and the code on 'Gerar Pix', with no dialog", async () => {
    const { createOrder } = await pixRaised();
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ method: "PIX" }));
    expect(screen.getByTestId("list-pix-title").textContent).toBe("Pague R$ 27,00 com Pix");
    expect(screen.getByTestId("list-pix-code").textContent).toBe("00020126BR.GOV.BCB.PIX.o-pix");
    expect(screen.getByTestId("list-pix-valid").textContent).toMatch(/^Válido até .+\. Copie o código e cole no app do seu banco, em Pix copia e cola\.$/);
    expect(screen.getByTestId("list-pix-toggle-qr").textContent).toBe("Ver QR code (pagar de outro celular)");
    expect(screen.getByTestId("list-pay").textContent).toBe("Copiar código Pix");
    expect(screen.getByTestId("list-bar-summary").textContent).toBe("2 itens · Entrega grátis");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("copies the code on a tap of the code itself, then waits in the bar", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await pixRaised();
    const code = screen.getByTestId("list-pix-code");
    expect(code.getAttribute("role")).toBe("button");
    expect(code.getAttribute("aria-label")).toBe("Copiar código Pix");
    fireEvent.click(code);
    await screen.findByTestId("pix-after-copy");
    expect(writeText).toHaveBeenCalledWith("00020126BR.GOV.BCB.PIX.o-pix");
    expect(screen.getByTestId("list-waiting").textContent).toBe("Aguardando o pagamento do Pix…");
  });

  it("copies from the bar's button the same way", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await pixRaised();
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("pix-after-copy");
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it("holds the Pix bar in the host's words while a step above is reopened", async () => {
    const createOrder = recordingCreateOrder();
    const host = { config: onPageStore(), client: stubClient([]), createOrder };
    const { rerender } = renderList(host);
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(payButton());
    await screen.findByTestId("list-pix");
    const { listFlow } = await import("./list-harness");
    rerender(listFlow({ ...host, list: { hold: { action: "Confirme o endereço", reason: "Confirme o endereço no passo 3." } } }));
    await waitFor(() => expect(payButton().textContent).toBe("Confirme o endereço"));
    expect(payButton().disabled).toBe(true);
    expect(screen.getByTestId("list-blocked-reason").textContent).toBe("Confirme o endereço no passo 3.");
  });

  it("opens the QR on the phone's link, and goes back to the list on 'Trocar a forma de pagamento'", async () => {
    await pixRaised();
    fireEvent.click(screen.getByTestId("list-pix-toggle-qr"));
    expect(screen.getByTestId("list-pix-toggle-qr").textContent).toBe("Esconder QR code");
    fireEvent.click(screen.getByTestId("list-pix-change-method"));
    await screen.findByTestId("payment-list");
    expect(radio("list-option-PIX").checked).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("list-pix")).toBeNull());
  });
});

describe("the hand-off store", () => {
  it("offers 'Pix ou cartão' alone, and goes straight to the provider's page", async () => {
    const navigate = vi.fn();
    const createOrder = vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({
      ok: true,
      data: orderFor(input.method, { hostedCheckoutUrl: "https://pay.example/checkout/1" }),
    }));
    renderList({ config: handOffStore(), client: stubClient([]), createOrder, navigate, taxIdOnFile: true, buyer: { name: "Ana", phone: "11987654321" } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-option-PIX")).toBeNull());
    fireEvent.click(radio("list-option-HAND_OFF"));
    fireEvent.click(payButton());
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://pay.example/checkout/1"));
    expect(screen.getByTestId("list-waiting").textContent).toBe("Aguardando a InfinitePay…");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
