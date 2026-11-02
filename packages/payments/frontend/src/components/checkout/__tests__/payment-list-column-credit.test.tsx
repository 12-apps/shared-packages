// @vitest-environment jsdom
/**
 * FUT-3711 — the computer's "Resumo do pedido" column, from the entrega UI
 * review:
 *
 *  - the host's context line under "Total" is in the secondary ink, as in the
 *    phone's bar — not whatever the host's element is inked in;
 *  - a balance the host holds (store credit) is drawn under "Total", then
 *    "A pagar" and the amount due — but ONLY while an online option is chosen,
 *    the only time the button charges the amount due. A door option or no
 *    choice charges the cart's total, so "Total" stands alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { CheckoutDoorOption } from "../list/types";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const LINES = [{ key: "combo", quantity: 1, name: "Combo", totalLabel: "R$ 22,00" }];
const CREDIT = { label: "Crédito da loja", amountLabel: "− R$ 5,00" };
const WITH_CREDIT = { credit: CREDIT, amountDueLabel: "R$ 22,00", totalCents: 2200 };
/** The balance covers the whole cart (`totalCents: 0`). */
const COVERED = { credit: { label: "Crédito da loja", amountLabel: "− R$ 27,00" }, amountDueLabel: "R$ 0,00", totalCents: 0 };

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

function door(): CheckoutDoorOption {
  return { id: "cash", label: "Dinheiro", action: "Enviar pedido", blocked: null, onSend: vi.fn() };
}

/** The column, once its body has landed. */
async function column(): Promise<HTMLElement> {
  const found = await screen.findByTestId("list-summary-column");
  await within(found).findByTestId("list-summary-body");
  return found;
}

beforeEach(() => {
  window.sessionStorage.clear();
  frameWidth(1280);
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("the column's context line", () => {
  it("is in the secondary ink, inside a host element inked otherwise", async () => {
    const aside = document.createElement("aside");
    aside.style.color = "rgb(94, 17, 19)";
    document.body.appendChild(aside);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { summaryTarget: aside, summary: "1 item · Taxa de entrega R$ 5,00" } });
    const line = await within(aside).findByTestId("list-bar-summary");
    expect(getComputedStyle(line).color).toBe("rgba(0, 0, 0, 0.6)");
    aside.remove();
  });
});

describe("store credit in the column", () => {
  it("an online choice: the credit and 'A pagar' under Total, the button charging the amount due", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: WITH_CREDIT });
    const drawn = await column();
    expect(within(drawn).getByTestId("pay-bar-total").textContent).toBe("R$ 27,00");
    const credit = await within(drawn).findByTestId("list-summary-credit-row");
    expect(credit.textContent).toBe("Crédito da loja− R$ 5,00");
    const due = within(drawn).getByTestId("list-summary-due-row");
    expect(due.textContent).toBe("A pagarR$ 22,00");
    // Total, then the credit, then "A pagar" — in that order down the column.
    const total = within(drawn).getByTestId("payment-step-total");
    expect(total.compareDocumentPosition(credit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(credit.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(within(drawn).getByTestId("list-pay").textContent).toBe("PagarR$ 22,00"));
  });

  it("a door choice: Total alone, over the button charging the cart's total", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { ...WITH_CREDIT, door: [door()] } });
    const drawn = await column();
    await within(drawn).findByTestId("list-summary-credit-row");
    fireEvent.click(screen.getByTestId("list-door-cash-radio"));
    await waitFor(() => expect(within(drawn).getByTestId("list-pay").textContent).toBe("Enviar pedidoR$ 27,00"));
    await waitFor(() => expect(within(drawn).queryByTestId("list-summary-credit")).toBeNull());
    expect(within(drawn).getByTestId("pay-bar-total").textContent).toBe("R$ 27,00");
  });

  it("no choice: Total alone", async () => {
    // No saved card, no remembered method: nothing comes chosen.
    renderList({ config: onPageStore(), client: stubClient([]), lines: LINES, list: WITH_CREDIT });
    const drawn = await column();
    await within(drawn).findByTestId("list-pay");
    // The options land only after the saved-card lookup answers, later than the
    // pay button; a loaded runner reached this line before them (FUT-4167).
    expect(await screen.findByTestId("list-option-PIX-radio")).toHaveProperty("checked", false);
    await waitFor(() => expect(within(drawn).queryByTestId("list-summary-credit")).toBeNull());
    fireEvent.click(screen.getByTestId("list-option-PIX-radio"));
    expect((await within(drawn).findByTestId("list-summary-due-row")).textContent).toBe("A pagarR$ 22,00");
  });

  it("covered by the balance: 'A pagar R$ 0,00' for an online choice, Total alone for a door one", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { ...COVERED, door: [door()] } });
    const drawn = await column();
    expect((await within(drawn).findByTestId("list-summary-due-row")).textContent).toBe("A pagarR$ 0,00");
    fireEvent.click(screen.getByTestId("list-door-cash-radio"));
    await waitFor(() => expect(within(drawn).queryByTestId("list-summary-credit")).toBeNull());
    expect(within(drawn).getByTestId("list-pay").textContent).toBe("Enviar pedidoR$ 27,00");
  });

  it("draws neither row without the host's credit, nor without the amount due", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { amountDueLabel: "R$ 22,00" } });
    const drawn = await column();
    expect(within(drawn).getByTestId("payment-step-total")).toBeTruthy();
    await waitFor(() => expect(within(drawn).queryByTestId("list-summary-credit")).toBeNull());
    cleanup();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { credit: CREDIT } });
    const again = await column();
    expect(within(again).getByTestId("payment-step-total")).toBeTruthy();
    await waitFor(() => expect(within(again).queryByTestId("list-summary-credit")).toBeNull());
  });
});
