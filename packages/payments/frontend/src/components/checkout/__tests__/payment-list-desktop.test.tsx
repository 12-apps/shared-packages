// @vitest-environment jsdom
/**
 * FUT-3685, L4 and T20 — on a computer the Pagamento list sits beside a
 * "Resumo do pedido" column holding the cart's lines, the host's fee rows,
 * "Total", the host's context line and the pay button; there is no bar at the
 * bottom. On a phone the bar stays (L2) and there is no column.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import { CHARGE_WINDOW_MS } from "../list/use-list-charge";
import { WIDE_CHECKOUT_MIN } from "../payment-step-layout";
import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const LINES = [{ key: "combo", quantity: 1, name: "Combo", totalLabel: "R$ 22,00" }];
const FEE = <div data-testid="fee-row">Taxa de entrega R$ 5,00</div>;

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  cleanup();
});

describe("on a computer (L4)", () => {
  it("draws 'Resumo do pedido' beside the list: lines, fees, Total, the context line and the pay button", async () => {
    frameWidth(1280);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, discountLines: FEE, list: { summary: "1 item · Taxa de entrega R$ 5,00" } });
    const column = await screen.findByTestId("list-summary-column");
    expect(within(column).getByRole("heading", { name: "Resumo do pedido" })).toBeTruthy();
    expect(within(column).getByText("1× Combo")).toBeTruthy();
    expect(within(column).getByText("R$ 22,00")).toBeTruthy();
    expect(within(column).getByTestId("fee-row")).toBeTruthy();
    expect(within(column).getByText("Total")).toBeTruthy();
    expect(within(column).getByTestId("pay-bar-total").textContent).toBe("R$ 27,00");
    await waitFor(() => expect(within(column).getByTestId("list-bar-summary").textContent).toBe("1 item · Taxa de entrega R$ 5,00"));
    const pay = within(column).getByTestId("list-pay");
    await waitFor(() => expect((pay as HTMLButtonElement).disabled).toBe(false));
    expect(pay.textContent).toBe("PagarR$ 27,00");
    // The list is in the other column, and nothing is drawn as a bar.
    await waitFor(() => expect(within(column).queryByTestId("payment-list")).toBeNull());
    expect(screen.getAllByTestId("list-pay")).toHaveLength(1);
  });

  it("runs the card's 5-second bar with Cancelar inside the column (K1)", async () => {
    frameWidth(1280);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]) });
    const column = await screen.findByTestId("list-summary-column");
    await waitFor(() => expect((within(column).getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
    vi.useFakeTimers();
    fireEvent.click(within(column).getByTestId("list-pay"));
    expect(within(column).getByTestId("list-charge-bar").textContent).toBe("Pagando R$ 27,00 no Visa final 4242…");
    fireEvent.click(within(column).getByTestId("list-charge-cancel"));
    vi.advanceTimersByTime(CHARGE_WINDOW_MS);
    expect(within(column).getByTestId("list-pay")).toBeTruthy();
  });
});

describe("on a phone (L2)", () => {
  it("has no column: the bar carries the context line and the button", async () => {
    frameWidth(WIDE_CHECKOUT_MIN - 1);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { summary: "1 item · Taxa de entrega R$ 5,00" } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-summary-column")).toBeNull());
    const bar = screen.getByTestId("list-pay-bar");
    expect(within(bar).getByTestId("list-bar-summary").textContent).toBe("1 item · Taxa de entrega R$ 5,00");
    expect(within(bar).getByTestId("list-pay")).toBeTruthy();
  });
});

describe("the host's own two columns (FUT-3685 review C2)", () => {
  it("portals the column — lines, Total and the pay button — into the host's element, and draws no columns of its own", async () => {
    frameWidth(1280);
    const aside = document.createElement("aside");
    aside.setAttribute("data-testid", "host-aside");
    document.body.appendChild(aside);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, list: { summaryTarget: aside, summary: "1 item" } });
    await screen.findByTestId("payment-list");
    const column = await within(aside).findByTestId("list-summary-column");
    expect(within(column).getByText("1× Combo")).toBeTruthy();
    expect(within(column).getByTestId("list-pay")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("list-columns")).toBeNull());
    expect(screen.getAllByTestId("list-pay")).toHaveLength(1);
    aside.remove();
  });

  it("waits, drawing no bar, while the host's element is not mounted yet", async () => {
    frameWidth(1280);
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), list: { summaryTarget: null } });
    await screen.findByTestId("payment-list");
    await waitFor(() => expect(screen.queryByTestId("list-pay")).toBeNull());
  });

  it("keeps the Pix screen's own bar on a computer: the column is the list's alone (K9)", async () => {
    frameWidth(1280);
    renderList({ config: onPageStore(), client: stubClient([]), list: {} });
    fireEvent.click(await screen.findByTestId("list-option-PIX-radio"));
    await waitFor(() => expect((screen.getByTestId("list-pay") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-pix");
    await waitFor(() => expect(screen.queryByTestId("list-summary-column")).toBeNull());
    expect(screen.getByTestId("list-pay-bar")).toBeTruthy();
  });
});
