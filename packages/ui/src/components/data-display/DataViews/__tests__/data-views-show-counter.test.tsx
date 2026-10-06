/**
 * A host without the "N de N" counter (showCounter, FUT-3335).
 *
 * Section headings handed to the grid as rows are counted as results, so a host
 * listing groups needs the counter off — and off for the LADDER too: a counter
 * that is hidden but still priced leaves a gap and sheds filters for nothing.
 * jsdom has no ResizeObserver; the bar's width is installed by a fake, as in
 * `data-views-quick-filters-measured.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type { DataViewColumn, FilterFieldConfig, QuickFilterConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  shelf: string;
  kind: string;
}

const rows: Row[] = [
  { id: "1", name: "Água", shelf: "empty", kind: "MENU" },
  { id: "2", name: "Baly", shelf: "below", kind: "RAW" },
];

const columns: DataViewColumn<Row>[] = [{ id: "name", header: "Produto", accessor: "name", searchable: true }];

const fields: FilterFieldConfig<Row>[] = [
  { id: "shelf", label: "Exposição", options: [{ value: "empty", label: "Vazia" }, { value: "below", label: "Abaixo" }] },
  { id: "kind", label: "Tipo", inMore: true, options: [{ value: "MENU", label: "Cardápio" }, { value: "RAW", label: "Insumo" }] },
];

const quickFilters: QuickFilterConfig[] = [
  { id: "empty", label: "Exposição vazia", fieldId: "shelf", value: "empty", count: 3, tone: "error" },
  { id: "below", label: "Abaixo", fieldId: "shelf", value: "below", count: 1, tone: "warning" },
];

function stubResizeObserver(width: number): void {
  class FakeResizeObserver {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.callback([{ target, contentRect: { width } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
}

type GridProps = Partial<React.ComponentProps<typeof DataViewsGrid<Row>>>;

function bar(props: GridProps = {}): React.JSX.Element {
  return (
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        inlineFilters
        rows={rows}
        columns={columns}
        fields={fields}
        quickFilters={quickFilters}
        getRowId={(row) => row.id}
        testIdPrefix="stock"
        {...props}
      />
    </ThemeProvider>
  );
}

function renderBar(width: number, props: GridProps = {}): ReturnType<typeof render> {
  stubResizeObserver(width);
  return render(bar(props));
}

/** The chips on the bar, in render order. */
function chipsOnBar(): string[] {
  return [...screen.getByTestId("stock-inline-filters").querySelectorAll("[data-testid^='stock-quick-']")].map(
    (element) => element.getAttribute("data-testid") ?? "",
  );
}

const APPLIED = { search: "", pills: { kind: ["RAW"] }, ranges: {}, sortBy: [], visibleColumns: [] };

/** Is "Limpar" on a bar of `width` with a filter applied, with or without the counter? */
function limparAt(width: number, showCounter: boolean): boolean {
  const view = renderBar(width, { showCounter, appliedState: APPLIED });
  const kept = screen.queryAllByTestId("stock-clear-all").length > 0;
  view.unmount();
  return kept;
}

/** How many chips a bar of `width` keeps, with or without the counter. */
function keptAt(width: number, showCounter: boolean): number {
  const view = renderBar(width, { showCounter });
  const kept = chipsOnBar().length;
  view.unmount();
  return kept;
}

afterEach(() => vi.unstubAllGlobals());

describe("showCounter", () => {
  it("shows the counter by default", () => {
    renderBar(1600);
    expect(screen.getByTestId("stock-counter")).toHaveTextContent("2 de 2");
  });

  it("leaves the counter off the bar when false", async () => {
    renderBar(1600, { showCounter: false });
    // The bar itself is there; only the counter is not.
    expect(screen.getByTestId("stock-inline-filters")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId("stock-counter")).toBeNull());
  });

  it("gives the counter's room back to the filters: a width exists where a chip stays only without it", () => {
    // Walk the widths where the chips start to shed; somewhere in that band the
    // counter's price is exactly what decides whether the last chip fits.
    // Not "never fewer at any width": the ladder sheds a filter before it
    // collapses the search, so a bar tight enough to collapse the search can
    // keep a chip a slightly roomier one sends to "Mais". What the option owes
    // is that the counter's price is gone, so some width keeps a chip for it.
    const widths = Array.from({ length: 40 }, (_, step) => 560 + step * 15);
    const decided = widths.filter((width) => keptAt(width, false) > keptAt(width, true));
    expect(decided.length).toBeGreaterThan(0);
  }, 30_000);


  it("keeps a chip at 690px only without the counter", () => {
    // Pinned so a regression to "priced but hidden" fails here, not just in the sweep.
    expect(keptAt(690, false)).toBe(1);
    expect(keptAt(690, true)).toBe(0);
  });

  it("keeps Limpar on a narrower bar without the counter, with a filter applied", () => {
    // The counter's room also pays for the Limpar rung: at 360px it stays only without it.
    expect(limparAt(360, false)).toBe(true);
    expect(limparAt(360, true)).toBe(false);
  });
});
