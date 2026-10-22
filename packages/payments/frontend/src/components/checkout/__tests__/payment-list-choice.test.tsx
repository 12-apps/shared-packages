// @vitest-environment jsdom
/**
 * FUT-3591 — the Pagamento step as ONE list.
 *
 * Online and pay-at-the-door in one radio group under two headings; a saved
 * card comes chosen and nothing else ever does; and choosing — anything, any
 * number of times — creates nothing. The order is raised only by the bar's
 * button, which FUT-3592's suite drives.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import { SAVED_MASTER, SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

afterEach(() => cleanup());

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const reason = (): string | null => screen.queryByTestId("list-blocked-reason")?.textContent ?? null;

function door(overrides: Partial<CheckoutDoorOption> = {}): CheckoutDoorOption {
  return { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: "Diga se precisa de troco.", onSend: vi.fn(), ...overrides };
}

describe("one list, two headings, one group", () => {
  it("draws the online options and the host's door options under their headings, as one radio group", async () => {
    renderList({ config: onPageStore(), client: stubClient(), list: { door: [door(), door({ id: "reader", label: "Maquininha", hint: "Crédito ou débito" })] } });
    await screen.findByTestId("payment-list");
    expect(screen.getByText("Como você quer pagar?")).toBeTruthy();
    expect(screen.getByText("Pagar agora, pelo app")).toBeTruthy();
    expect(screen.getByText("Pagar na entrega")).toBeTruthy();
    const names = ["list-option-PIX", "list-option-CARD", "list-door-cash", "list-door-reader"].map((id) => radio(id).name);
    expect(new Set(names).size).toBe(1);
    expect(screen.getByTestId("list-option-CARD").textContent).toContain("Cartão de crédito");
  });

  it("draws the door heading alone when the store offers nothing online", async () => {
    renderList({ config: onPageStore({ methods: [] }), client: stubClient(), list: { door: [door()] } });
    await screen.findByTestId("payment-list");
    expect(screen.getByText("Pagar na entrega")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Pagar agora, pelo app")).toBeNull());
  });

  it("draws no door heading for a host that passes no door options", async () => {
    renderList({ config: onPageStore(), client: stubClient() });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByText("Pagar na entrega")).toBeNull());
  });

  it("draws neither the method tabs nor the order summary", async () => {
    renderList({ config: onPageStore(), client: stubClient(), orderNote: <p>Sem cebola</p> });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByRole("tablist")).toBeNull());
    await waitFor(() => expect(screen.queryByText("Sem cebola")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("checkout-stepper")).toBeNull());
  });
});

describe("what comes chosen", () => {
  it("chooses the card and its saved card for a buyer with one, and Pagar is live", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    expect(screen.getByTestId("list-card-vault-1").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("list-option-CARD").textContent).toContain("Visa final 4242 ou outro cartão");
    expect(payButton().disabled).toBe(false);
    expect(payButton().textContent).toBe("PagarR$ 27,00");
  });

  it("chooses the head of the saved list when there are several — the host orders it last-used first", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_MASTER, SAVED_VISA]) });
    await waitFor(() => expect(screen.getByTestId("list-card-vault-2").getAttribute("aria-checked")).toBe("true"));
    expect(screen.getByTestId("list-card-vault-1").getAttribute("aria-checked")).toBe("false");
  });

  it("chooses nothing for a buyer with no saved card, and says so once, on the held button", async () => {
    const client = stubClient([]);
    renderList({ config: onPageStore(), client });
    await waitFor(() => expect(client.listInstruments).toHaveBeenCalled());
    await screen.findByTestId("payment-list");
    expect(radio("list-option-PIX").checked).toBe(false);
    expect(radio("list-option-CARD").checked).toBe(false);
    expect(payButton().disabled).toBe(true);
    expect(payButton().textContent).toBe("Escolha como pagar");
    // The button already says it: the helper does not repeat it (U4), the live region still does.
    expect(reason()).toBeNull();
    expect(screen.getByTestId("list-bar-live").textContent).toBe("Escolha como pagar.");
  });

  it("never chooses a store's ONLY method for the buyer, and so raises nothing", async () => {
    const createOrder = vi.fn();
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient(), createOrder });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(false));
    expect(createOrder).not.toHaveBeenCalled();
  });
});

describe("picking creates nothing", () => {
  it("raises no order however many times the buyer changes their mind", async () => {
    const createOrder = vi.fn();
    const client = stubClient([SAVED_VISA]);
    renderList({ config: onPageStore(), client, createOrder, list: { door: [door()] } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    for (const id of ["list-option-PIX", "list-door-cash", "list-option-CARD"]) fireEvent.click(radio(id));
    fireEvent.click(screen.getByTestId("list-card-new"));
    fireEvent.click(radio("list-option-PIX"));
    expect(createOrder).not.toHaveBeenCalled();
    expect(client.charge).not.toHaveBeenCalled();
  });

  it("comes back to the saved card when the card is chosen again, keeping what was typed", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    fireEvent.click(screen.getByTestId("list-card-new"));
    fireEvent.change(screen.getByTestId("card-holder"), { target: { value: "ANA TESTE" } });
    fireEvent.click(radio("list-option-PIX"));
    fireEvent.click(radio("list-option-CARD"));
    await waitFor(() => expect(screen.getByTestId("list-card-vault-1").getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByTestId("list-card-new"));
    expect((screen.getByTestId("card-holder") as HTMLInputElement).value).toBe("ANA TESTE");
  });

  it("tells the host every change of choice, door options included", async () => {
    const onChoiceChange = vi.fn();
    renderList({ config: onPageStore(), client: stubClient(), list: { door: [door()], onChoiceChange } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-door-cash"));
    fireEvent.click(radio("list-option-PIX"));
    expect(onChoiceChange).toHaveBeenCalledWith({ kind: "door", id: "cash" });
    expect(onChoiceChange).toHaveBeenLastCalledWith({ kind: "online", method: "PIX" });
  });
});

describe("the door slot", () => {
  it("opens the host's content inside the chosen door option, and the button is the host's", async () => {
    const onSend = vi.fn();
    const { rerender } = renderList({ config: onPageStore(), client: stubClient(), list: { door: [door({ content: <p>Precisa de troco?</p>, onSend })] } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByText("Precisa de troco?")).toBeNull());
    fireEvent.click(radio("list-door-cash"));
    expect(within(screen.getByTestId("list-door-cash")).getByText("Precisa de troco?")).toBeTruthy();
    expect(payButton().textContent).toBe("Enviar pedidoR$ 27,00");
    expect(payButton().disabled).toBe(true);
    expect(reason()).toBe("Diga se precisa de troco.");
    // The host answers its own question, and rebuilds its option.
    const { listFlow } = await import("./list-harness");
    rerender(listFlow({ config: onPageStore(), client: stubClient(), list: { door: [door({ blocked: null, onSend, totalLabel: "R$ 22,00" })] } }));
    await waitFor(() => expect(payButton().disabled).toBe(false));
    expect(payButton().textContent).toBe("Enviar pedidoR$ 22,00");
    fireEvent.click(payButton());
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("keeps a plain content closed while idle — today's behaviour, unchanged (FUT-3715)", async () => {
    renderList({ config: onPageStore(), client: stubClient(), list: { door: [door({ content: <p>Troco?</p> })] } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByText("Troco?")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-door-cash-content")).toBeNull());
  });

  it("draws the content while idle only when the host asks, on the row's unchosen frame (FUT-3715)", async () => {
    renderList({ config: onPageStore(), client: stubClient(), list: { door: [door({ content: <p>Troco?</p>, showContentWhileIdle: true })] } });
    await screen.findByTestId("payment-list");
    const row = screen.getByTestId("list-door-cash");
    expect(row.getAttribute("data-chosen")).toBe("false");
    expect(within(row).getByText("Troco?")).toBeTruthy();
    expect(radio("list-door-cash").checked).toBe(false);
  });

  it("lets a function content choose its row, and reports it like the radio (FUT-3715)", async () => {
    const onChoiceChange = vi.fn();
    const seen: boolean[] = [];
    renderList({
      config: onPageStore(),
      client: stubClient(),
      list: {
        onChoiceChange,
        door: [
          door({
            showContentWhileIdle: true,
            content: ({ chosen, choose }) => {
              seen.push(chosen);
              return (
                <button type="button" onClick={choose}>
                  R$ 50
                </button>
              );
            },
          }),
        ],
      },
    });
    await screen.findByTestId("payment-list");
    expect(seen.at(-1)).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "R$ 50" }));
    await waitFor(() => expect(radio("list-door-cash").checked).toBe(true));
    expect(seen.at(-1)).toBe(true);
    await waitFor(() => expect(onChoiceChange).toHaveBeenLastCalledWith({ kind: "door", id: "cash" }));
  });

  it("changes nothing when content chooses a row that is already chosen (FUT-3715)", async () => {
    const onChoiceChange = vi.fn();
    renderList({
      config: onPageStore(),
      client: stubClient(),
      list: {
        onChoiceChange,
        door: [door({ content: ({ choose }) => <button type="button" onClick={choose}>Sem troco</button> })],
      },
    });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(onChoiceChange).toHaveBeenLastCalledWith({ kind: "door", id: "cash" }));
    const calls = onChoiceChange.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Sem troco" }));
    fireEvent.click(screen.getByRole("button", { name: "Sem troco" }));
    await waitFor(() => expect(radio("list-door-cash").checked).toBe(true));
    expect(onChoiceChange.mock.calls.length).toBe(calls);
  });

  it("hides a door option's hint while it is chosen when the host asks", async () => {
    renderList({ config: onPageStore(), client: stubClient(), list: { door: [door({ id: "reader", label: "Maquininha", hint: "Crédito ou débito", hideHintWhileChosen: true })] } });
    await screen.findByTestId("payment-list");
    expect(screen.getByText("Crédito ou débito")).toBeTruthy();
    fireEvent.click(radio("list-door-reader"));
    await waitFor(() => expect(screen.queryByText("Crédito ou débito")).toBeNull());
  });
});

describe("the bar", () => {
  it("draws the host's line always, and its online extras only while an online option is chosen", async () => {
    renderList({
      config: onPageStore(),
      client: stubClient([SAVED_VISA]),
      list: { summary: "2 itens · Taxa de entrega R$ 5,00", onlineExtras: <label>Usar meus R$ 5,00 de crédito na loja</label>, door: [door()] },
    });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    expect(screen.getByTestId("list-bar-summary").textContent).toBe("2 itens · Taxa de entrega R$ 5,00");
    expect(screen.getByText("Usar meus R$ 5,00 de crédito na loja")).toBeTruthy();
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(screen.queryByText("Usar meus R$ 5,00 de crédito na loja")).toBeNull());
    expect(screen.getByTestId("list-bar-summary")).toBeTruthy();
  });

  it("says who is paying when the CPF is on file, with the way to change it", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), taxIdOnFile: true, list: { door: [door()] } });
    await waitFor(() => expect(screen.getByTestId("list-payer").textContent).toContain("Pagando como Ana Teste · CPF ✓"));
    expect(screen.getByTestId("list-payer-change")).toBeTruthy();
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(screen.queryByTestId("list-payer")).toBeNull());
  });

  it("holds the button in the host's words while a step before this one is open", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { hold: { action: "Escolha o horário", reason: "Escolha o horário no passo 2." } } });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    expect(payButton().disabled).toBe(true);
    expect(payButton().textContent).toBe("Escolha o horárioR$ 27,00");
    expect(reason()).toBe("Escolha o horário no passo 2.");
  });
});
