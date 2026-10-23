// @vitest-environment jsdom
/**
 * FUT-3942 — a list's only option comes chosen (owner, 2026-10-23: "se só tem
 * uma opção … já vir selecionada"). A hand-off store's "Pix ou cartão" is the
 * case that asked for it: one online row, with or without door rows beside it.
 * Choosing still raises nothing; the bar's button does.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import { SAVED_VISA, handOffStore, listFlow, onPageStore, renderList, stubClient } from "./list-harness";

const radio = (testId: string): HTMLInputElement => screen.getByTestId(`${testId}-radio`) as HTMLInputElement;
const payButton = (): HTMLButtonElement => screen.getByTestId("list-pay") as HTMLButtonElement;
const doorRow = (id: string, label: string): CheckoutDoorOption => ({ id, label, action: "Enviar pedido", blocked: null, onSend: vi.fn() });

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe("a hand-off store", () => {
  it("comes with 'Pix ou cartão' chosen and the button live, raising nothing", async () => {
    const createOrder = vi.fn();
    const onChoiceChange = vi.fn();
    renderList({ config: handOffStore(), client: stubClient(), createOrder, buyer: { name: "Ana Teste", phone: "11987654321" }, list: { onChoiceChange } });
    await waitFor(() => expect(radio("list-option-HAND_OFF").checked).toBe(true));
    expect(payButton().disabled).toBe(false);
    expect(payButton().textContent).not.toContain("Escolha como pagar");
    expect(onChoiceChange).toHaveBeenLastCalledWith({ kind: "online", method: "HAND_OFF" });
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("chooses it even with door rows beside it", async () => {
    renderList({ config: handOffStore(), client: stubClient(), list: { door: [doorRow("cash", "Dinheiro"), doorRow("reader", "Maquininha")] } });
    await waitFor(() => expect(radio("list-option-HAND_OFF").checked).toBe(true));
    expect(radio("list-door-cash").checked).toBe(false);
  });

  it("lets the buyer move to a door row, and does not take the choice back", async () => {
    renderList({ config: handOffStore(), client: stubClient(), list: { door: [doorRow("cash", "Dinheiro")] } });
    await waitFor(() => expect(radio("list-option-HAND_OFF").checked).toBe(true));
    fireEvent.click(radio("list-door-cash"));
    await waitFor(() => expect(radio("list-door-cash").checked).toBe(true));
    expect(radio("list-option-HAND_OFF").checked).toBe(false);
  });
});

describe("a store with one way to pay online", () => {
  it("chooses Pix at a Pix-only store", async () => {
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient() });
    await waitFor(() => expect(radio("list-option-PIX").checked).toBe(true));
  });

  it("chooses the card, its fields open, at a card-only store with nothing saved", async () => {
    renderList({ config: onPageStore({ methods: ["CARD"] }), client: stubClient() });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    expect(screen.getByTestId("card-number")).toBeTruthy();
  });
});

describe("a store paid only at the door", () => {
  it("chooses its only door row", async () => {
    renderList({ config: onPageStore({ methods: [] }), client: stubClient(), list: { door: [doorRow("cash", "Dinheiro")] } });
    await waitFor(() => expect(radio("list-door-cash").checked).toBe(true));
  });

  it("chooses nothing with two door rows", async () => {
    renderList({ config: onPageStore({ methods: [] }), client: stubClient(), list: { door: [doorRow("cash", "Dinheiro"), doorRow("reader", "Maquininha")] } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(payButton().textContent).toContain("Escolha como pagar"));
    expect(radio("list-door-cash").checked).toBe(false);
    expect(radio("list-door-reader").checked).toBe(false);
  });
});

describe("a store with a choice to make", () => {
  it("still chooses nothing for a buyer with no history and no saved card", async () => {
    renderList({ config: onPageStore(), client: stubClient() });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(payButton().textContent).toContain("Escolha como pagar"));
    expect(radio("list-option-PIX").checked).toBe(false);
    expect(radio("list-option-CARD").checked).toBe(false);
  });

  it("still chooses the saved card", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
  });
});

describe("options that change after the list mounted", () => {
  it("lands on the saved card, not empty fields, when the chain resolves late to a card-only store", async () => {
    const client = stubClient([SAVED_VISA]);
    const { rerender } = renderList({ config: onPageStore({ methods: [] }), client, list: { door: [doorRow("cash", "Dinheiro"), doorRow("reader", "Maquininha")] } });
    await screen.findByTestId("payment-list");
    rerender(listFlow({ config: onPageStore({ methods: ["CARD"] }), client, list: { door: [doorRow("cash", "Dinheiro"), doorRow("reader", "Maquininha")] } }));
    await waitFor(() => expect(radio("list-option-CARD").checked).toBe(true));
    await waitFor(() => expect(screen.getByTestId("list-card-vault-1")).toBeTruthy());
    // eslint-disable-next-line test-flakiness/no-element-removal-check -- never rendered: the saved card is selected, so the fields stay closed
    expect(screen.queryByTestId("card-number")).toBeNull();
  });

  it("never re-picks for a buyer who already touched the list", async () => {
    const client = stubClient();
    const doors = [doorRow("cash", "Dinheiro"), doorRow("reader", "Maquininha")];
    const { rerender } = renderList({ config: onPageStore({ methods: [] }), client, list: { door: doors } });
    await screen.findByTestId("payment-list");
    fireEvent.click(radio("list-door-reader"));
    await waitFor(() => expect(radio("list-door-reader").checked).toBe(true));
    // The chosen row goes away, leaving a single one: the buyer chose, so nothing is chosen for them.
    rerender(listFlow({ config: onPageStore({ methods: [] }), client, list: { door: [doors[0] as CheckoutDoorOption] } }));
    await waitFor(() => expect(payButton().textContent).toContain("Escolha como pagar"));
    expect(radio("list-door-cash").checked).toBe(false);
  });

  it("clears a chosen door row the host stopped offering, and chooses the sole option left", async () => {
    const client = stubClient();
    const { rerender } = renderList({ config: onPageStore({ methods: [] }), client, list: { door: [doorRow("cash", "Dinheiro")] } });
    await waitFor(() => expect(radio("list-door-cash").checked).toBe(true));
    rerender(listFlow({ config: handOffStore(), client, list: { door: [] } }));
    await waitFor(() => expect(radio("list-option-HAND_OFF").checked).toBe(true));
  });
});
