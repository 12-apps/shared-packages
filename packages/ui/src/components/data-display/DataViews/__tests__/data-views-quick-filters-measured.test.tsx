/**
 * QUICK CHIPS ON A MEASURED BAR (FUT-3330, review round 1).
 *
 * jsdom has no ResizeObserver, so the bar's width is installed by a fake — the
 * same harness `data-views-overflow.test.tsx` uses. These pin what the
 * unmeasured tests cannot: a chip with no room goes into "Mais" as a toggle
 * row, a pressed chip keeps its slot, chips stay in their declared order, and
 * an `inMore` field keeps "Mais" on the bar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import type {
  DataViewColumn,
  DataViewQuery,
  DataViewServer,
  FilterFieldConfig,
  QuickFilterConfig,
} from "../data-views-types";

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

function renderBar(width: number, props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}): void {
  stubResizeObserver(width);
  render(
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
    </ThemeProvider>,
  );
}

/** The chips on the bar, in render order. */
function chipsOnBar(): string[] {
  return [...screen.getByTestId("stock-inline-filters").querySelectorAll("[data-testid^='stock-quick-']")].map(
    (element) => element.getAttribute("data-testid") ?? "",
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("quick chips on a measured bar", () => {
  it("are on the bar, in declared order, where there is room", () => {
    renderBar(1600);
    expect(chipsOnBar()).toEqual(["stock-quick-empty", "stock-quick-below"]);
  });

  it.each([1600, 1100])("keep their slot when pressed where the bar has room, at %ipx", (width) => {
    renderBar(width);
    const before = chipsOnBar();
    expect(before.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId(before[0] ?? ""));
    expect(chipsOnBar()).toEqual(before);
    expect(screen.getByTestId(before[0] ?? "")).toHaveAttribute("aria-pressed", "true");
  });

  it.each([1600, 1100, 900, 800, 700])(
    "never swap a pressed chip for another one, at %ipx: it stays, or the chips leave together",
    (width) => {
      renderBar(width);
      const before = chipsOnBar();
      if (before[0] === undefined) return;
      fireEvent.click(screen.getByTestId(before[0]));
      const after = chipsOnBar();
      // Either the same chips in the same order, or none — never a different first chip.
      expect(after.length === 0 || after[0] === before[0]).toBe(true);
      expect(before.slice(0, after.length)).toEqual(after);
    },
  );

  it.each([1100, 900, 800, 700, 600, 500, 420, 360])(
    "stay a prefix of their order at %ipx: never the second without the first",
    (width) => {
      renderBar(width);
      const shown = chipsOnBar();
      expect(["stock-quick-empty", "stock-quick-below"].slice(0, shown.length)).toEqual(shown);
    },
  );

  it("go into Mais as toggle rows with their counts when the bar has no room, and toggle from there", () => {
    renderBar(360);
    expect(chipsOnBar()).toEqual([]);
    fireEvent.click(screen.getByTestId("stock-more-filters"));
    const panel = screen.getByTestId("stock-more-panel");
    const row = within(panel).getByTestId("stock-more-quick-empty");
    expect(row).toHaveTextContent("Exposição vazia3");

    fireEvent.click(within(row).getByRole("checkbox"));
    expect(within(row).getByRole("checkbox")).toBeChecked();
    // The trigger counts the pressed chip as an applied filter behind it.
    expect(screen.getByTestId("stock-more-badge")).toHaveTextContent("1");
  });
});

describe("inMore on a measured bar", () => {
  it("keeps the field behind Mais even with room to spare", () => {
    renderBar(1600);
    fireEvent.click(screen.getByTestId("stock-more-filters"));
    expect(within(screen.getByTestId("stock-more-panel")).getByTestId("stock-more-kind-MENU")).toBeInTheDocument();
  });
});

describe("quick chips in server mode", () => {
  it("send the chip's value as the field's pill in the next query", () => {
    const queries: DataViewQuery[] = [];
    const server: DataViewServer = {
      totalCount: 2,
      page: 1,
      pageSize: 20,
      onQueryChange: (query) => queries.push(query),
    };
    renderBar(1600, { server });
    fireEvent.click(screen.getByTestId("stock-quick-below"));
    expect(queries.at(-1)?.pills.shelf).toEqual(["below"]);
    fireEvent.click(screen.getByTestId("stock-quick-below"));
    expect(queries.at(-1)?.pills.shelf ?? []).toEqual([]);
  });
});
