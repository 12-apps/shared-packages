/**
 * QUICK CHIPS, `inMore` FIELDS AND THE STICKY HEAD (FUT-3330).
 *
 * A quick chip writes the same state a pill would — `pills[fieldId] =
 * [value]` — so the rows it narrows to, the counter and "Limpar" all treat it
 * as the filter it is. The pill field it targets is not drawn as a pill; an
 * `inMore` field is never on the bar; the sticky head's offset never leaves
 * its own table.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "./test-utils";
import { ThemeProvider, createTheme } from "../../../../mui/styles";

import { DataViewsGrid } from "../DataViewsGrid";
import { toOverflowFields } from "../data-views-overflow";
import { headShift } from "../data-views-sticky-head";
import type { DataViewColumn, FilterFieldConfig, QuickFilterConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  shelf: string;
  kind: string;
}

const rows: Row[] = [
  { id: "1", name: "Água", shelf: "empty", kind: "MENU" },
  { id: "2", name: "Baly", shelf: "below", kind: "MENU" },
  { id: "3", name: "Coca", shelf: "ok", kind: "RAW" },
];

const columns: DataViewColumn<Row>[] = [{ id: "name", header: "Produto", accessor: "name", searchable: true }];

const fields: FilterFieldConfig<Row>[] = [
  {
    id: "shelf",
    label: "Exposição",
    options: [
      { value: "empty", label: "Vazia" },
      { value: "below", label: "Abaixo do mínimo" },
    ],
  },
  { id: "kind", label: "Tipo", inMore: true, options: [{ value: "MENU", label: "Cardápio" }, { value: "RAW", label: "Insumo" }] },
];

const quickFilters: QuickFilterConfig[] = [
  { id: "empty", label: "Exposição vazia", fieldId: "shelf", value: "empty", count: 1, tone: "error" },
  { id: "below", label: "Abaixo do mínimo", fieldId: "shelf", value: "below", count: 1, tone: "warning" },
];

function renderGrid(props: Partial<React.ComponentProps<typeof DataViewsGrid<Row>>> = {}): void {
  render(
    <ThemeProvider theme={createTheme()}>
      <DataViewsGrid<Row>
        inlineFilters
        rows={rows}
        columns={columns}
        fields={fields}
        quickFilters={quickFilters}
        getRowId={(row) => row.id}
        dataTestId="stock"
        testIdPrefix="stock"
        {...props}
      />
    </ThemeProvider>,
  );
}

const counter = (): string => screen.getByTestId("stock-counter").textContent ?? "";

/** Every control on the filter bar, by test id — a positive read of what IS there. */
const barIds = (): string[] =>
  [...screen.getByTestId("stock-inline-filters").querySelectorAll("[data-testid]")].map(
    (element) => element.getAttribute("data-testid") ?? "",
  );

describe("quick filter chips", () => {
  it("draw on the bar with their counts, and stand in for the pill they write to", () => {
    renderGrid();
    expect(screen.getByTestId("stock-quick-empty")).toHaveTextContent("Exposição vazia1");
    expect(screen.getByTestId("stock-quick-below")).toHaveAttribute("aria-pressed", "false");
    // The "Exposição" pill is the chips' field: no pill of its own.
    expect(barIds()).toContain("stock-quick-empty");
    expect(barIds()).not.toContain("stock-filter-shelf");
  });

  it("leave the field a plain pill when no chip targets it (the test id above is real)", () => {
    renderGrid({ quickFilters: [], fields: [fields[0] as FilterFieldConfig<Row>, { ...(fields[1] as FilterFieldConfig<Row>), inMore: false }] });
    expect(screen.getByTestId("stock-filter-shelf")).toBeInTheDocument();
    expect(screen.getByTestId("stock-filter-kind")).toBeInTheDocument();
  });

  it("narrow the rows to their value, exclusively within the field, and clear when pressed again", () => {
    renderGrid();
    fireEvent.click(screen.getByTestId("stock-quick-empty"));
    expect(screen.getByTestId("stock-quick-empty")).toHaveAttribute("aria-pressed", "true");
    expect(counter()).toBe("1 de 3");
    expect(screen.getByText("Água")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("stock-quick-below"));
    expect(screen.getByTestId("stock-quick-empty")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("stock-quick-below")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Baly")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("stock-quick-below"));
    expect(counter()).toBe("3 de 3");
  });

  it("are a filter for Limpar too", () => {
    renderGrid();
    fireEvent.click(screen.getByTestId("stock-quick-empty"));
    fireEvent.click(screen.getByTestId("stock-clear-all"));
    expect(screen.getByTestId("stock-quick-empty")).toHaveAttribute("aria-pressed", "false");
    expect(counter()).toBe("3 de 3");
  });
});

describe("inMore fields", () => {
  it("never take a place on the bar, so Mais is always there to hold them", () => {
    renderGrid();
    expect(barIds()).not.toContain("stock-filter-kind");
    expect(screen.getByTestId("stock-more-filters")).toBeInTheDocument();
  });

  it("are marked pinned, chips first, and the chips' field left out", () => {
    const placed = toOverflowFields(fields, [], quickFilters);
    expect(placed.map((field) => [field.id, field.group, field.pinned === true])).toEqual([
      ["quick:empty", "quick", false],
      ["quick:below", "quick", false],
      ["kind", "pill", true],
    ]);
  });
});

describe("headShift", () => {
  it("is zero while the table's top is below the sticky edge", () => {
    expect(headShift(300, 800, 36, 120)).toBe(0);
  });

  it("follows the page once the table's top passes under the edge", () => {
    expect(headShift(-100, 800, 36, 120)).toBe(220);
  });

  it("never pushes the header past the bottom of its own table", () => {
    expect(headShift(-900, 800, 36, 120)).toBe(764);
  });
});
