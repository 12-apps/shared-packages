// @vitest-environment jsdom
/**
 * FUT-4416 — the chosen way to pay in "Resumo do pedido" (E26, E29–E31): the
 * method's own discount line under the host's money rows, and the figure under
 * the rule named for what is paid — "A pagar", "A pagar na entrega", "até"
 * when the amount depends on what is passed at the door. A choice with no
 * price keeps today's "Total" and the cart's total. On a phone the discount
 * line is in the bar, as the column's is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const LINES = [{ key: "a", quantity: 1, name: "Pizza", totalLabel: "R$ 143,00" }];
const PIX = { amountLabel: "R$ 126,75", amountCents: 12675, discount: { label: "Desconto no Pix", amountLabel: "−R$ 11,95" } };
const CARD = { amountLabel: "R$ 138,70", amountCents: 13870 };

function reader(): CheckoutDoorOption {
  return { id: "reader", label: "Maquininha", action: "Enviar pedido", blocked: null, onSend: vi.fn(), price: { amountLabel: "R$ 138,70", upTo: true } };
}

function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

async function column(): Promise<HTMLElement> {
  const found = await screen.findByTestId("list-summary-column");
  await within(found).findByTestId("list-summary-body");
  return found;
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("on a computer", () => {
  beforeEach(() => frameWidth(1280));

  it("a priced online choice: its discount line, then 'A pagar' and its amount", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { lastMethod: "PIX", prices: { online: { PIX, CARD } } } });
    const drawn = await column();
    await waitFor(() => expect(within(drawn).getByTestId("list-price-discount").textContent).toBe("Desconto no Pix−R$ 11,95"));
    const total = within(drawn).getByTestId("payment-step-total");
    expect(total.textContent).toBe("A pagarR$ 126,75");
    expect(within(drawn).getByTestId("list-price-discount").compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a priced choice with no discount: no line, and its amount", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { prices: { online: { PIX, CARD } } } });
    const drawn = await column();
    await waitFor(() => expect(within(drawn).getByTestId("payment-step-total").textContent).toBe("A pagarR$ 138,70"));
    await waitFor(() => expect(within(drawn).queryByTestId("list-price-discount")).toBeNull());
  });

  it("a door choice priced 'até': 'A pagar na entrega até …'", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { door: [reader()] } });
    const drawn = await column();
    fireEvent.click(await screen.findByTestId("list-door-reader-radio"));
    await waitFor(() => expect(within(drawn).getByTestId("payment-step-total").textContent).toBe("A pagar na entregaaté R$ 138,70"));
  });

  it("no price: 'Total' and the cart's total, as today", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES });
    const drawn = await column();
    expect(within(drawn).getByTestId("payment-step-total").textContent).toBe("TotalR$ 27,00");
    await waitFor(() => expect(within(drawn).queryByTestId("list-price-discount")).toBeNull());
  });

  it("with the host's credit rows, Total stays the cart's and 'A pagar' names the chosen row's amount", async () => {
    renderList({
      config: onPageStore(),
      client: stubClient([SAVED_VISA]),
      lines: LINES,
      list: { credit: { label: "Crédito da loja", amountLabel: "−R$ 20,00" }, amountDueLabel: "R$ 118,70", totalCents: 11870, prices: { online: { CARD: { amountLabel: "R$ 118,70", amountCents: 11870 } } } },
    });
    const drawn = await column();
    await waitFor(() => expect(within(drawn).getByTestId("list-summary-due-row").textContent).toBe("A pagarR$ 118,70"));
    expect(within(drawn).getByTestId("payment-step-total").textContent).toBe("TotalR$ 27,00");
  });
});

describe("on a phone", () => {
  it("the chosen row's discount line is in the bar, and moves with the choice", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { lastMethod: "PIX", prices: { online: { PIX, CARD } } } });
    const bar = await screen.findByTestId("list-pay-bar");
    await waitFor(() => expect(within(bar).getByTestId("list-price-discount").textContent).toBe("Desconto no Pix−R$ 11,95"));
    fireEvent.click(screen.getByTestId("list-option-CARD-radio"));
    await waitFor(() => expect(within(bar).queryByTestId("list-price-discount")).toBeNull());
  });
});
