// @vitest-environment jsdom
/**
 * FUT-3692 — the host's lines in the computer's "Resumo do pedido" column.
 *
 * A checkout that settles a READY total (a comanda's conta) is not paying the
 * cart, so the column drew no lines — only "Total". The mesa's Pagamento has
 * to say what the conta is made of, the way every other store type's column
 * does, so the host can hand its own lines in (`paymentList.lines`):
 *
 *  - beside a ready total, the column draws the host's lines above "Total";
 *  - without them it draws "Total" alone, as before;
 *  - a cart checkout keeps the cart's lines when the host gives none;
 *  - a phone draws no column, so nothing there changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cleanup, screen, waitFor, within } from "@testing-library/react";

import { SAVED_VISA, onPageStore, renderList, stubClient } from "./list-harness";

const CONTA = { scope: "MINE", totalLabel: "R$ 52,80", totalItems: 2 };
const CONTA_LINES = [
  { key: "l-pastel", quantity: 1, name: "Pastel na Chapa", totalLabel: "R$ 24,00" },
  { key: "l-suco", quantity: 2, name: "Suco de laranja", totalLabel: "R$ 24,00" },
];
const CART_LINES = [{ key: "combo", quantity: 1, name: "Combo", totalLabel: "R$ 22,00" }];

/** The flow's frame measures this wide. */
function frameWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width, height: 800, top: 0, left: 0, right: width, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
}

/** The column, once its body has landed. */
async function columnBody(): Promise<HTMLElement> {
  const found = await screen.findByTestId("list-summary-column");
  return within(found).findByTestId("list-summary-body");
}

/** The lines the column lists, as "quantity× name — total" reads in the DOM. */
function drawnLines(body: HTMLElement): string[] {
  return within(body)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
}

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("the column beside a ready total", () => {
  beforeEach(() => frameWidth(1280));

  it("draws the host's lines above Total", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), settlement: CONTA, list: { lines: CONTA_LINES } });
    const body = await columnBody();

    const lines = within(body).getByTestId("checkout-summary-lines");
    expect(drawnLines(body)).toEqual([
      expect.stringContaining("Pastel na Chapa"),
      expect.stringContaining("Suco de laranja"),
    ]);
    expect(drawnLines(body)[1]).toContain("R$ 24,00");
    const total = within(body).getByTestId("pay-bar-total");
    expect(total.textContent).toBe("R$ 52,80");
    expect(lines.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws Total alone when the host gives no lines, and never the cart's", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), settlement: CONTA, lines: CART_LINES });
    const body = await columnBody();

    expect(within(body).getByTestId("pay-bar-total").textContent).toBe("R$ 52,80");
    await waitFor(() => expect(within(body).queryByTestId("checkout-summary-lines")).toBeNull());
  });
});

describe("the column of a cart checkout", () => {
  beforeEach(() => frameWidth(1280));

  it("keeps the cart's lines when the host gives none", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), lines: CART_LINES });
    const body = await columnBody();

    expect(drawnLines(body)).toEqual([expect.stringContaining("Combo")]);
  });
});

describe("a phone", () => {
  beforeEach(() => frameWidth(390));

  it("draws no column, lines or not", async () => {
    renderList({ config: onPageStore(), client: stubClient([SAVED_VISA]), settlement: CONTA, list: { lines: CONTA_LINES } });

    await screen.findByTestId("list-pay");
    await waitFor(() => expect(screen.queryByTestId("list-summary-column")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("checkout-summary-lines")).toBeNull());
  });
});
