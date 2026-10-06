/**
 * A DEFAULT quick chip (`QuickFilterConfig.default`, FUT-3335).
 *
 * The page's unfiltered view is one of the chips ("Precisa repor"). The chip
 * reads pressed while its field is EMPTY, so the default view is no filter:
 * no "Limpar" on arrival, no "Mais" badge, and "Limpar" from any other chip
 * lands back on it. Before, the host seeded `[value]` to light the chip, and
 * "Limpar" showed on arrival and did nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import { isQuickActive, toggleQuick } from "../data-views-overflow-fields";
import type { DataViewColumn, DataViewState, FilterFieldConfig, QuickFilterConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  shelf: string;
}

const rows: Row[] = [
  { id: "1", name: "Água", shelf: "empty" },
  { id: "2", name: "Baly", shelf: "below" },
];

const columns: DataViewColumn<Row>[] = [{ id: "name", header: "Produto", accessor: "name", searchable: true }];

const fields: FilterFieldConfig<Row>[] = [
  {
    id: "shelf",
    label: "Situação",
    options: [
      { value: "need", label: "Precisa repor" },
      { value: "empty", label: "Vazios" },
      { value: "below", label: "Abaixo do mínimo" },
    ],
  },
];

const need: QuickFilterConfig = { id: "need", label: "Precisa repor", fieldId: "shelf", value: "need", default: true };
const empty: QuickFilterConfig = { id: "empty", label: "Vazios", fieldId: "shelf", value: "empty", tone: "error" };
const below: QuickFilterConfig = { id: "below", label: "Abaixo do mínimo", fieldId: "shelf", value: "below" };
const quickFilters = [need, empty, below];

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

function renderGrid(onStateChange?: (state: DataViewState) => void): void {
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
        onStateChange={onStateChange}
      />
    </ThemeProvider>,
  );
}

const pressed = (id: string): string | null => screen.getByTestId(`stock-quick-${id}`).getAttribute("aria-pressed");

afterEach(() => vi.unstubAllGlobals());

describe("a default quick chip", () => {
  it("is pressed by the empty field, and only a field that is empty or exactly its value", () => {
    expect(isQuickActive(need, {})).toBe(true);
    expect(isQuickActive(need, { shelf: [] })).toBe(true);
    expect(isQuickActive(need, { shelf: ["need"] })).toBe(true);
    expect(isQuickActive(need, { shelf: ["empty"] })).toBe(false);
    // A plain chip is unchanged: the empty field is not it.
    expect(isQuickActive(empty, {})).toBe(false);
  });

  it("empties its field when pressed, and stays pressed when pressed again", () => {
    expect(toggleQuick({ shelf: ["empty"] }, need)).toEqual({ shelf: [] });
    expect(toggleQuick({}, need)).toEqual({ shelf: [] });
    // A plain chip still toggles.
    expect(toggleQuick({}, empty)).toEqual({ shelf: ["empty"] });
    expect(toggleQuick({ shelf: ["empty"] }, empty)).toEqual({ shelf: [] });
  });

  it("lights the default view with no Limpar, and Limpar from another chip lands back on it", async () => {
    renderGrid();
    expect(pressed("need")).toBe("true");
    expect(pressed("empty")).toBe("false");
    await waitFor(() => expect(screen.queryByTestId("stock-clear-all")).toBeNull());

    fireEvent.click(screen.getByTestId("stock-quick-empty"));
    expect(pressed("empty")).toBe("true");
    expect(pressed("need")).toBe("false");

    fireEvent.click(await screen.findByTestId("stock-clear-all"));
    expect(pressed("need")).toBe("true");
    await waitFor(() => expect(screen.queryByTestId("stock-clear-all")).toBeNull());
  });

  it("writes an empty field, never its value, when pressed from another chip", () => {
    const changes: DataViewState[] = [];
    renderGrid((state) => changes.push(state));
    fireEvent.click(screen.getByTestId("stock-quick-below"));
    fireEvent.click(screen.getByTestId("stock-quick-need"));
    expect(changes.at(-1)?.pills.shelf ?? []).toEqual([]);
    expect(pressed("need")).toBe("true");
  });

  it("does not read as applied in Mais when the chips are in there on the default view", async () => {
    stubResizeObserver(320);
    renderGrid();
    // The chips went to "Mais" at this width. Its label names what is applied;
    // the default view applies nothing.
    const more = await screen.findByTestId("stock-more-filters");
    expect(more.getAttribute("aria-label")).toBe("Mais filtros: 3 sem espaço na barra");
    fireEvent.click(more);
    // Nor does the default chip's row offer a clear that would do nothing.
    expect(await screen.findByTestId("stock-more-panel")).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^stock-more-quick:need-clear$/)).toHaveLength(0);
  });
});
