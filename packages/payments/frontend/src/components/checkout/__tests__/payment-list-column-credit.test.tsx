// @vitest-environment jsdom
/**
 * FUT-3711 — the computer's "Resumo do pedido" column, from the entrega UI
 * review:
 *
 *  - the host's context line under "Total" is in the secondary ink, as in the
 *    phone's bar — not whatever the host's element is inked in;
 *  - a balance the host holds (store credit) is drawn under "Total", then
 *    "A pagar" and the amount due, so Total − credit reads as what the button
 *    charges.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, screen, waitFor, within } from "@testing-library/react";

import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const LINES = [{ key: "combo", quantity: 1, name: "Combo", totalLabel: "R$ 22,00" }];
const CREDIT = { label: "Crédito da loja", amountLabel: "− R$ 5,00" };

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
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
  it("draws the credit and 'A pagar' under Total, the button charging the amount due", async () => {
    renderList({
      config: onPageStore(),
      client: stubClient([SAVED_VISA]),
      lines: LINES,
      list: { credit: CREDIT, amountDueLabel: "R$ 22,00", totalCents: 2200 },
    });
    const column = await screen.findByTestId("list-summary-column");
    expect(within(column).getByTestId("pay-bar-total").textContent).toBe("R$ 27,00");
    const credit = within(column).getByTestId("list-summary-credit-row");
    expect(credit.textContent).toBe("Crédito da loja− R$ 5,00");
    const due = within(column).getByTestId("list-summary-due-row");
    expect(due.textContent).toBe("A pagarR$ 22,00");
    // Total, then the credit, then "A pagar" — in that order down the column.
    const total = within(column).getByTestId("payment-step-total");
    expect(total.compareDocumentPosition(credit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(credit.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(within(column).getByTestId("list-pay").textContent).toBe("PagarR$ 22,00"));
  });

  it("draws neither row without the host's credit, nor without the amount due", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { amountDueLabel: "R$ 22,00" } });
    const column = await screen.findByTestId("list-summary-column");
    expect(within(column).getByTestId("payment-step-total")).toBeTruthy();
    await waitFor(() => expect(within(column).queryByTestId("list-summary-credit")).toBeNull());
    cleanup();
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { credit: CREDIT } });
    const again = await screen.findByTestId("list-summary-column");
    expect(within(again).getByTestId("payment-step-total")).toBeTruthy();
    await waitFor(() => expect(within(again).queryByTestId("list-summary-credit")).toBeNull());
  });
});
