// @vitest-environment jsdom
/**
 * FUT-5290 — a host may draw the online rows and its door options as ONE list
 * under no heading (`paymentList.ungrouped`), and a door option may carry a
 * short pill (`tag`). Without them the two headed groups stay exactly as drawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import { onPageStore, renderList, stubClient } from "./list-harness";

const doorRow = (id: string, label: string, tag?: string): CheckoutDoorOption => ({
  id,
  label,
  hint: `${label} hint`,
  ...(tag ? { tag } : {}),
  action: "Chamar",
  blocked: null,
  onSend: vi.fn(),
});

const rows = (): string[] =>
  Array.from(screen.getByTestId("payment-list").querySelectorAll<HTMLInputElement>("input[type='radio']")).map((input) => input.value);

beforeEach(() => window.sessionStorage.clear());
afterEach(cleanup);

describe("an ungrouped list", () => {
  const door = [doorRow("cash", "Dinheiro", "Chama o garçom"), doorRow("reader", "Maquininha", "Chama o garçom")];

  it("draws the online rows then the door options, under no heading and in no group", async () => {
    renderList({ config: onPageStore({ methods: ["PIX", "CARD"] }), client: stubClient(), list: { door, ungrouped: true } });
    await waitFor(() => expect(screen.getByTestId("list-door-cash")).toBeTruthy());
    expect(rows()).toEqual(["PIX", "CARD", "door:cash", "door:reader"]);
    expect(screen.queryAllByRole("group")).toHaveLength(0);
    // One radio group, named by the list's title, so a screen reader still announces it.
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getByRole("radiogroup", { name: "Como você quer pagar?" })).toBeTruthy();
    expect(screen.queryAllByText("Pagar agora, pelo app")).toHaveLength(0);
    expect(screen.queryAllByText("Pagar na entrega")).toHaveLength(0);
  });

  it("keeps it one radio group: choosing a door row unchooses the online one", async () => {
    renderList({ config: onPageStore({ methods: ["PIX", "CARD"] }), client: stubClient(), list: { door, ungrouped: true } });
    await waitFor(() => expect(screen.getByTestId("list-door-cash")).toBeTruthy());
    fireEvent.click(screen.getByTestId("list-door-cash-radio"));
    await waitFor(() => expect((screen.getByTestId("list-door-cash-radio") as HTMLInputElement).checked).toBe(true));
    expect((screen.getByTestId("list-option-PIX-radio") as HTMLInputElement).checked).toBe(false);
  });

  it("draws a door option's tag, chosen or not", async () => {
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient(), list: { door, ungrouped: true } });
    await waitFor(() => expect(screen.getAllByText("Chama o garçom")).toHaveLength(2));
  });
});

describe("a door option's tag", () => {
  const tagged = (): CheckoutDoorOption[] => [doorRow("cash", "Dinheiro", "Chama o garçom"), doorRow("plain", "Outro")];

  it("is still drawn once its row is chosen", async () => {
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient(), list: { door: tagged(), ungrouped: true } });
    await waitFor(() => expect(screen.getByTestId("list-door-cash")).toBeTruthy());
    fireEvent.click(screen.getByTestId("list-door-cash-radio"));
    await waitFor(() => expect(screen.getByTestId("list-door-cash").getAttribute("data-chosen")).toBe("true"));
    expect(within(screen.getByTestId("list-door-cash")).getAllByText("Chama o garçom")).toHaveLength(1);
  });

  it("is drawn only on the row that carries one", async () => {
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient(), list: { door: tagged(), ungrouped: true } });
    await waitFor(() => expect(screen.getByTestId("list-door-plain")).toBeTruthy());
    expect(within(screen.getByTestId("list-door-plain")).queryAllByText("Chama o garçom")).toHaveLength(0);
    expect(screen.getAllByText("Chama o garçom")).toHaveLength(1);
  });

  it("is drawn on a priced row too", async () => {
    const priced: CheckoutDoorOption = { ...doorRow("cash", "Dinheiro", "Chama o garçom"), price: { amountLabel: "R$ 10,00" } };
    renderList({ config: onPageStore({ methods: ["PIX"] }), client: stubClient(), list: { door: [priced], ungrouped: true } });
    await waitFor(() => expect(screen.getByTestId("list-door-cash")).toBeTruthy());
    expect(within(screen.getByTestId("list-door-cash")).getAllByText("Chama o garçom")).toHaveLength(1);
  });
});

describe("a list that is not ungrouped", () => {
  it("keeps its two headed groups", async () => {
    renderList({ config: onPageStore({ methods: ["PIX", "CARD"] }), client: stubClient(), list: { door: [doorRow("cash", "Dinheiro")] } });
    await waitFor(() => expect(screen.getByTestId("list-door-cash")).toBeTruthy());
    expect(screen.getAllByRole("group")).toHaveLength(2);
    expect(screen.getByText("Pagar agora, pelo app")).toBeTruthy();
  });
});
