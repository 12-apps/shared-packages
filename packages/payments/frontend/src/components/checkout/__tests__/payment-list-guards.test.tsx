// @vitest-environment jsdom
/**
 * FUT-3591/3592, review round 1 — what keeps the list from charging the wrong
 * thing, twice, or without the buyer's say.
 *
 *  - a hold the host raises mid-bar, a total that moves mid-bar, or the screen
 *    going away mid-bar: nothing is sent;
 *  - a held CARD order priced differently from the cart is raised again, never
 *    charged at its old amount; the button names the cart's amount;
 *  - a host send in flight locks the list;
 *  - the details asked inline come with the Dados step's LGPD consent;
 *  - a stale Pix offers "Atualizar pagamento" in the bar;
 *  - the focus follows the bar and comes back after Cancelar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import type { CheckoutDoorOption } from "../list/types";
import type { CreateOrderRequest, CreateOrderResult } from "../types";
import { SAVED_VISA, listFlow, onPageStore, orderFor, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const raising = () => vi.fn(async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("a bar that must stop", () => {
  it("cancels when the host raises a hold mid-bar, and sends nothing", async () => {
    const createOrder = raising();
    const host = { config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder };
    const { rerender } = renderList(host);
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await advance(2000);
    rerender(listFlow({ ...host, list: { hold: { action: "Confirme o endereço", reason: "Confirme o endereço no passo 3." } } }));
    await advance(CHARGE_WINDOW_MS * 2);
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByTestId("list-charge-bar")).toBeNull());
    expect(createOrder).not.toHaveBeenCalled();
    expect(host.client.charge).not.toHaveBeenCalled();
    expect(payButton().textContent).toBe("Confirme o endereço" + "R$ 27,00");
  });

  it("cancels when the total moves mid-bar, and names the amount frozen at the press", async () => {
    const createOrder = raising();
    const host = { config: onPageStore(), client: stubClient([SAVED_VISA]), createOrder };
    const { rerender } = renderList(host);
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    expect(screen.getByTestId("list-charge-bar").textContent).toBe("Pagando R$ 27,00 no Visa 4242…");
    rerender(listFlow({ ...host, cartTotal: "R$ 22,00" }));
    await advance(CHARGE_WINDOW_MS * 2);
    vi.useRealTimers();
    await waitFor(() => expect(screen.queryByTestId("list-charge-bar")).toBeNull());
    expect(createOrder).not.toHaveBeenCalled();
    expect(payButton().textContent).toBe("PagarR$ 22,00");
  });

  it("sends nothing when the checkout goes away mid-bar", async () => {
    const createOrder = raising();
    const client = stubClient([SAVED_VISA]);
    const { unmount } = renderList({ config: onPageStore(), client, createOrder });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    unmount();
    await advance(CHARGE_WINDOW_MS * 2);
    expect(createOrder).not.toHaveBeenCalled();
    expect(client.charge).not.toHaveBeenCalled();
  });
});

describe("the amount charged is the amount shown", () => {
  /** A card refused once leaves its CARD order held at R$ 27,00. */
  async function refusedOnce(createOrder: ReturnType<typeof vi.fn>, client: ReturnType<typeof stubClient>, extra = {}) {
    client.charge.mockResolvedValueOnce({ ok: false, error: "Recusado.", code: "INVALID" } as never);
    const host = { config: onPageStore(), client, createOrder, ...extra };
    const view = renderList(host);
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await advance(CHARGE_WINDOW_MS);
    vi.useRealTimers();
    await screen.findByText("Recusado.");
    return { host, ...view };
  }

  it("raises again, at the new price, when the cart was re-priced under a held order", async () => {
    const createOrder = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: orderFor("CARD") })
      .mockResolvedValueOnce({ ok: true, data: orderFor("CARD", { orderId: "o-card-2", totalCents: 2200, totalLabel: "R$ 22,00" }) });
    const client = stubClient([SAVED_VISA]);
    const { host, rerender } = await refusedOnce(createOrder, client);
    rerender(listFlow({ ...host, cartTotal: "R$ 22,00" }));
    await waitFor(() => expect(payButton().textContent).toBe("PagarR$ 22,00"));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    await advance(CHARGE_WINDOW_MS);
    vi.useRealTimers();
    await waitFor(() => expect(client.charge).toHaveBeenCalledTimes(2));
    expect(createOrder).toHaveBeenCalledTimes(2);
    expect(client.charge).toHaveBeenLastCalledWith(expect.objectContaining({ orderId: "o-card-2" }));
  });

  it("names the cart's amount, not the held card order's, for a door option with no amount of its own", async () => {
    const createOrder = vi.fn().mockResolvedValue({ ok: true, data: orderFor("CARD", { totalLabel: "R$ 22,00", totalCents: 2200 }) });
    const door: CheckoutDoorOption = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
    await refusedOnce(createOrder, stubClient([SAVED_VISA]), { list: { door: [door] } });
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(payButton().textContent).toBe("Enviar pedidoR$ 27,00"));
  });
});

describe("a send in flight locks the list", () => {
  it("locks the list and holds the button while the host's door send is pending", async () => {
    const onSend = vi.fn();
    const door: CheckoutDoorOption = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend, pending: true };
    renderList({ config: onPageStore(), client: stubClient(), list: { door: [door] } });
    await screen.findByTestId("payment-list");
    expect(screen.getByTestId("payment-list").getAttribute("data-locked")).toBe("true");
    expect(screen.getByTestId("payment-list").hasAttribute("inert")).toBe(true);
    expect(payButton().disabled).toBe(true);
  });

  it("locks the list while a Pix is being raised", async () => {
    const finishers: ((value: CreateOrderResult) => void)[] = [];
    const createOrder = vi.fn(() => new Promise<CreateOrderResult>((resolve) => finishers.push(resolve)));
    renderList({ config: onPageStore(), client: stubClient(), createOrder });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(payButton());
    await waitFor(() => expect(screen.getByTestId("payment-list").getAttribute("data-locked")).toBe("true"));
    fireEvent.click(payButton());
    expect(createOrder).toHaveBeenCalledTimes(1);
    await act(async () => finishers[0]?.({ ok: true, data: orderFor("PIX") }));
  });
});

describe("the LGPD consent beside the CPF at the top", () => {
  async function newBuyerPix(saveBuyerContact: ReturnType<typeof vi.fn>, createOrder: ReturnType<typeof raising>) {
    renderList({ config: onPageStore(), client: stubClient(), taxIdOnFile: false, createOrder, saveBuyerContact });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.change(await screen.findByTestId("list-buyer-taxId"), { target: { value: "529.982.247-25" } });
  }

  it("offers 'Salvar meus dados para a próxima compra' ticked, as Dados does, and saves with it", async () => {
    const save = vi.fn();
    const createOrder = raising();
    await newBuyerPix(save, createOrder);
    const consent = within(screen.getByTestId("list-cpf")).getByLabelText("Salvar meus dados para a próxima compra") as HTMLInputElement;
    expect(consent.checked).toBe(true);
    fireEvent.click(payButton());
    await waitFor(() => expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ saveProfile: true })));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ taxId: "52998224725" }));
  });

  it("saves nothing when the buyer unticks it", async () => {
    const save = vi.fn();
    const createOrder = raising();
    await newBuyerPix(save, createOrder);
    fireEvent.click(screen.getByLabelText("Salvar meus dados para a próxima compra"));
    fireEvent.click(payButton());
    await waitFor(() => expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ saveProfile: false })));
    expect(save).not.toHaveBeenCalled();
  });
});

describe("a stale Pix in the list", () => {
  it("puts 'Atualizar pagamento' in the bar, which raises a new Pix", async () => {
    const createOrder = raising();
    const host = { config: onPageStore(), client: stubClient(), createOrder, basket: "l1x1" };
    const { rerender } = renderList(host);
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(payButton());
    await screen.findByTestId("list-pix");
    rerender(listFlow({ ...host, basket: "l1x3" }));
    await waitFor(() => expect(payButton().textContent).toBe("Atualizar pagamento"));
    await waitFor(() => expect(screen.queryByTestId("checkout-cart-changed-refresh")).toBeNull());
    fireEvent.click(payButton());
    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(2));
  });

  it("takes the veiled code out of the controls, and marks the veil's sentence an overlay (ADR 0121)", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const host = { config: onPageStore(), client: stubClient(), createOrder: raising(), basket: "l1x1" };
    const { rerender } = renderList(host);
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(payButton());
    const code = await screen.findByTestId("list-pix-code");
    // In the clear, the code is the bar's copy button.
    await waitFor(() => {
      expect(code.getAttribute("role")).toBe("button");
      expect(code.getAttribute("tabindex")).toBe("0");
    });

    rerender(listFlow({ ...host, basket: "l1x3" }));
    await waitFor(() => expect(payButton().textContent).toBe("Atualizar pagamento"));
    const veiled = screen.getByTestId("list-pix-code");
    await waitFor(() => {
      expect(veiled.getAttribute("role")).toBeNull();
      expect(veiled.getAttribute("tabindex")).toBeNull();
      expect(veiled.getAttribute("aria-label")).toBeNull();
    });
    fireEvent.click(veiled);
    fireEvent.keyDown(veiled, { key: "Enter" });
    expect(writeText).not.toHaveBeenCalled();
    const sentence = within(veiled.closest("[data-testid=pix-stale-veil]") as HTMLElement).getByText("Atualize para gerar um novo Pix");
    expect(sentence.hasAttribute("data-ui-overlay")).toBe(true);
  });

  // Moved from the tabbed checkout's `pix-stale-veil.test.tsx` (FUT-3535) when
  // the tabs went (FUT-4028): the after-copy face refuses a stale copy too.
  it("refuses the after-copy face's copy once the cart moved, and veils its QR", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const host = { config: onPageStore(), client: stubClient(), createOrder: raising(), basket: "l1x1" };
    const { rerender } = renderList(host);
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(payButton());
    fireEvent.click(await screen.findByTestId("list-pix-code"));
    await screen.findByTestId("pix-after-copy");
    // The first copy, before the cart moved, is the only one there may be.
    expect(writeText).toHaveBeenCalledTimes(1);

    // "Copiar de novo" is the bar's now (ADR 0129, FUT-1181): over a code the
    // cart outgrew the bar offers "Atualizar pagamento" in its place, and the
    // card has no copy of its own to press.
    expect(screen.getByTestId("pix-copy-again").textContent).toMatch(/Copiar de novo|Copiado!/);
    rerender(listFlow({ ...host, basket: "l1x3" }));
    await waitFor(() => expect(screen.getByTestId("list-pay").textContent).toBe("Atualizar pagamento"));
    expect(screen.getByTestId("pix-after-copy").textContent).not.toContain("Copiar de novo");
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId("pix-stale-veil").length).toBeGreaterThan(0);
  });
});

describe("the focus", () => {
  it("moves to Cancelar when the bar replaces Pagar, and back to Pagar after it", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    vi.useFakeTimers();
    fireEvent.click(payButton());
    vi.useRealTimers();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("list-charge-cancel")));
    fireEvent.click(screen.getByTestId("list-charge-cancel"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("list-pay")));
  });
});

describe("what the list says", () => {
  it("names each group by its heading, and keeps one live region in the bar", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { door: [{ id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: "Diga se precisa de troco.", onSend: vi.fn() }] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    const online = screen.getByRole("group", { name: "Pagar agora, pelo app" });
    expect(within(online).getByTestId("list-option-PIX-radio")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "Pagar na entrega" })).getByTestId("list-door-cash-radio")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Cartão de crédito" })).toBeTruthy();
    const live = screen.getByTestId("list-bar-live");
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(live.textContent).toBe("Diga se precisa de troco."));
    expect(screen.getByTestId("list-bar-live")).toBe(live);
  });

  it("names a card of an unknown network 'Cartão final …'", async () => {
    renderList({ config: onPageStore(), client: stubClient([{ ...SAVED_VISA, brand: "Unknown", last4: "1234" }]) });
    await waitFor(() => expect(screen.getByTestId("list-card-vault-1").textContent).toBe("Cartão 1234"));
  });

  it("clears a choice the store no longer offers once its config resolves", async () => {
    const client = stubClient([SAVED_VISA]);
    const { rerender } = renderList({ config: onPageStore(), client });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    rerender(listFlow({ config: onPageStore({ methods: ["PIX"] }), client }));
    await waitFor(() => expect(screen.queryByTestId("list-option-CARD")).toBeNull());
    // Pix is now the store's only option, so it comes chosen in the card's place (FUT-3942).
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(true));
  });

  it("leaves nothing chosen when the choice it cleared leaves two options", async () => {
    const client = stubClient([SAVED_VISA]);
    const door: CheckoutDoorOption = { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
    const reader: CheckoutDoorOption = { id: "reader", label: "Maquininha", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
    const { rerender } = renderList({ config: onPageStore(), client, list: { door: [door, reader] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    rerender(listFlow({ config: onPageStore({ methods: [] }), client, list: { door: [door, reader] } }));
    await waitFor(() => expect(screen.queryByTestId("list-option-CARD")).toBeNull());
    expect(radio("list-door-cash").checked).toBe(false);
    expect(radio("list-door-reader").checked).toBe(false);
    expect(payButton().textContent).toContain("Escolha como pagar");
    await waitFor(() => expect(screen.queryByTestId("list-blocked-reason")).toBeNull());
    expect(screen.getByTestId("list-bar-live").textContent).toBe("Escolha como pagar.");
  });
});

describe("a wire that fails", () => {
  it("treats a saved-card list that cannot be read as empty: nothing chosen, the list usable", async () => {
    const client = stubClient();
    client.listInstruments.mockRejectedValue(new Error("offline"));
    renderList({ config: onPageStore(), client });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-option-CARD"));
    expect(screen.getByTestId("card-number")).toBeTruthy();
  });
});
