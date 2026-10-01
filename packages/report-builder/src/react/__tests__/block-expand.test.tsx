// @vitest-environment jsdom
import { renderWithCopy } from "./with-copy";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { DashboardBlockRender, SavedReportView } from "../custom-reports-api";
import { BOUNDED_TABLE_MAX_HEIGHT_PX } from "../lib/bounded-table";
import { ReportViewCanvas } from "../report-view";
import type { ReportRender } from "../reports-api";

/**
 * A dashboard block's table stops at about ten rows and scrolls in place, and
 * the block offers to open it whole in a dialog (FUT-3167): a sixty-product
 * ranking drew sixty rows, so the block beside it ended a screen and a half
 * earlier and the rest of the canvas was pushed out of reach.
 */

const ROWS = Array.from({ length: 30 }, (_, index) => ({ product: `Produto ${index + 1}` }));

const TABLE_RENDER: ReportRender = {
  kind: "table",
  columns: [{ key: "product", label: "Produto", format: "text" }],
  rows: ROWS,
};

const CHART_RENDER: ReportRender = {
  kind: "chart",
  chartSpec: {
    type: "bar",
    xAxis: { key: "day", label: "Data (dia)" },
    series: [{ key: "revenueCents", label: "Receita" }],
    numberFormat: "brl",
  },
  tableColumns: [
    { key: "day", label: "Data (dia)", format: "text" },
    { key: "revenueCents", label: "Receita", format: "brl" },
  ],
  rows: [{ day: "01/08", revenueCents: 125_00 }],
};

const TABLE_BLOCK: DashboardBlockRender = {
  id: "tabela",
  title: "Vendas por produto",
  span: 6,
  sentence: "soma de receita em pedidos por produto",
  status: "ok",
  render: TABLE_RENDER,
};

const CHART_BLOCK: DashboardBlockRender = { ...TABLE_BLOCK, id: "grafico", render: CHART_RENDER };

function viewOf(blocks: DashboardBlockRender[]): SavedReportView {
  return {
    id: "rel-1",
    name: "Relatório",
    description: null,
    status: "published",
    visibility: "tenant",
    visibilityRoles: [],
    range: {
      preset: "30d",
      from: "2026-01-02T03:00:00.000Z",
      toExclusive: "2026-02-01T03:00:00.000Z",
    },
    type: "dashboard",
    spec: { kind: "dashboard", blocks: [] },
    blocks,
  };
}

/** Every rule emotion has emitted into this document, as one string. */
function emittedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((style) => style.textContent ?? "")
    .join("\n");
}

/**
 * Whether the element sits inside a box whose OWN class caps the table's
 * scroller. Read per element rather than over the whole document, because
 * emotion keeps every rule an earlier test emitted.
 */
function isBounded(element: HTMLElement): boolean {
  const css = emittedCss();
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    for (const name of Array.from(node.classList)) {
      if (!name.startsWith("css-")) continue;
      if (css.includes(`.${name} .MuiTableContainer-root{max-height:${BOUNDED_TABLE_MAX_HEIGHT_PX}px;`)) {
        return true;
      }
    }
  }
  return false;
}

afterEach(() => {
  cleanup();
});

describe("a dashboard block's table is bounded", () => {
  it("caps the table's scroller at about ten rows, with its header pinned", () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([TABLE_BLOCK])} />);

    // Positive control: the block drew its table, all thirty rows of it.
    const table = screen.getByTestId("report-block-tabela-render-table");
    expect(within(table).getAllByText(/^Produto \d+$/)).toHaveLength(30);
    expect(isBounded(table)).toBe(true);
    expect(emittedCss()).toMatch(/\.MuiTableHead-root \.MuiTableCell-root\{[^}]*position:sticky;top:0;/);
  });

  it("leaves a block with a chosen height to fill it, with no expand offered", () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([{ ...TABLE_BLOCK, height: 2 }])} />);

    expect(isBounded(screen.getByTestId("report-block-tabela-render-table"))).toBe(false);
    expect(screen.queryAllByTestId("report-block-tabela-render-expand")).toEqual([]);
  });
});

describe("expand opens the whole table in a dialog", () => {
  it("is a named icon in the block's tools", () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([TABLE_BLOCK])} />);
    const expand = screen.getByTestId("report-block-tabela-render-expand");

    expect(expand.getAttribute("aria-label")).toBe("Expandir tabela");
    expect(expand.querySelector("svg")).not.toBeNull();
  });

  it("shows every row of the same table, and closes", async () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([TABLE_BLOCK])} />);

    fireEvent.click(screen.getByTestId("report-block-tabela-render-expand"));

    const dialog = await screen.findByTestId("report-block-tabela-expanded");
    expect(within(dialog).getByText("Vendas por produto")).not.toBeNull();
    const whole = within(dialog).getByTestId("report-block-tabela-expanded-render-table");
    expect(within(whole).getAllByText(/^Produto \d+$/)).toHaveLength(30);
    // The dialog is where the table is read whole: no cap there.
    expect(isBounded(whole)).toBe(false);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryAllByTestId("report-block-tabela-expanded")).toEqual([]);
    });
  });

  it("is offered on a chart only while it is shown as its table", () => {
    renderWithCopy(<ReportViewCanvas view={viewOf([CHART_BLOCK])} />);

    expect(screen.queryAllByTestId("report-block-grafico-render-expand")).toEqual([]);
    fireEvent.click(screen.getByTestId("report-block-grafico-render-as-table"));
    expect(screen.getByTestId("report-block-grafico-render-expand")).not.toBeNull();
  });
});
