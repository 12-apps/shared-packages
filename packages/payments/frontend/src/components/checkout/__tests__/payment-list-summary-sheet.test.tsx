// @vitest-environment jsdom
/**
 * FUT-589 — "Resumo do pedido" on a phone, as a sheet the bar's line opens.
 *
 * A computer lists the order in the column beside the payment; a phone drew no
 * lines at all. The owner chose the bar's line as the way in (option B):
 *
 *  - on a phone the line carries "Ver resumo", and the whole line is one button;
 *  - it opens a sheet above the bar with the column's own body — the lines, the
 *    host's money rows, "Total" — and the focus lands on its heading;
 *  - Escape, the ✕, the scrim and the line close it, and the focus goes back
 *    to the line;
 *  - the host's money rows know they are in the sheet (`useInSummarySheet`), so
 *    a control among them can stay out of it;
 *  - a card charge that starts closes it;
 *  - a computer keeps its column and draws no "Ver resumo".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { JSX } from "react";

import { useInSummarySheet } from "../list/summary-sheet";

import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const LINES = [
  { key: "marmita", quantity: 1, name: "Marmita de Frango Grelhado", totalLabel: "R$ 26,90" },
  { key: "suco", quantity: 1, name: "Suco Natural 500ml", totalLabel: "R$ 10,90" },
];

/** The host's money rows, with a control that must stay on the page and out of the sheet. */
function MoneyRows(): JSX.Element {
  const inSheet = useInSummarySheet();
  return (
    <div data-testid="host-money-rows">
      <span>Cupom Paladira</span>
      <span>-R$ 3,78</span>
      {inSheet ? null : <input type="checkbox" aria-label="Usar meu saldo" />}
    </div>
  );
}

const SUMMARY = "2 itens · Taxa de entrega R$ 6,00";

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

function renderPhone(): void {
  renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: LINES, discountLines: <MoneyRows />, cartTotal: "R$ 40,02", list: { summary: SUMMARY } });
}

/** The sheet, once its body has landed. */
async function openSheet(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByTestId("list-summary-toggle"));
  const sheet = await screen.findByTestId("list-summary-sheet");
  await within(sheet).findByTestId("list-summary-body");
  return sheet;
}

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("a phone", () => {
  beforeEach(() => frameWidth(390));

  it("puts 'Ver resumo' on the bar's line, closed", async () => {
    renderPhone();
    const toggle = await screen.findByTestId("list-summary-toggle");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.textContent).toBe(`${SUMMARY}Ver resumo`);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("list-summary-column")).toBeNull());
  });

  it("opens the column's body above the bar: the lines, the money rows, Total", async () => {
    renderPhone();
    const sheet = await openSheet();
    expect(within(sheet).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["1× Marmita de Frango GrelhadoR$ 26,90", "1× Suco Natural 500mlR$ 10,90"]);
    expect(within(sheet).getByTestId("list-summary-money").textContent).toBe("Cupom Paladira-R$ 3,78");
    expect(within(sheet).getByTestId("pay-bar-total").textContent).toBe("R$ 40,02");
    expect(screen.getByTestId("list-summary-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("list-summary-sheet").getAttribute("aria-modal")).toBe("false");
    const heading = document.getElementById(screen.getByTestId("list-summary-sheet").getAttribute("aria-labelledby") ?? "");
    expect(heading?.textContent).toBe("Resumo do pedido");
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("tells the host's money rows they are in the sheet, so their control stays out of it", async () => {
    renderPhone();
    const sheet = await openSheet();
    expect(within(sheet).getByTestId("host-money-rows")).toBeTruthy();
    await waitFor(() => expect(within(sheet).queryByRole("checkbox", { name: "Usar meu saldo" })).toBeNull());
  });

  it("closes on Escape and gives the focus back to the line", async () => {
    renderPhone();
    await openSheet();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("list-summary-toggle")));
  });

  it("closes on the ✕, on the scrim and on the line itself", async () => {
    renderPhone();
    for (const closer of ["list-summary-close", "list-summary-scrim", "list-summary-toggle"]) {
      await openSheet();
      fireEvent.click(screen.getByTestId(closer));
      await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    }
  });

  it("closes when the card's charge starts, and stays closed while it runs", async () => {
    renderPhone();
    fireEvent.click(await screen.findByTestId("list-option-CARD-radio"));
    await openSheet();
    fireEvent.click(screen.getByTestId("list-pay"));
    await screen.findByTestId("list-charge-bar");
    await waitFor(() => expect(screen.queryByTestId("list-summary-sheet")).toBeNull());
    expect((screen.getByTestId("list-summary-toggle") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("a computer", () => {
  beforeEach(() => frameWidth(1280));

  it("keeps its column and draws no 'Ver resumo'", async () => {
    renderPhone();
    await screen.findByTestId("list-summary-column");
    await waitFor(() => expect(screen.queryByTestId("list-summary-toggle")).toBeNull());
    expect(screen.getByTestId("list-bar-summary").textContent).toBe(SUMMARY);
  });
});
