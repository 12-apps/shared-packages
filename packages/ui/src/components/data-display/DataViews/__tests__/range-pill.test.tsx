/**
 * Range filters as pills in the INLINE filter bar (FUT-668).
 *
 * The bar used to render pills only, so `rangeFields` had a surface on the
 * slide-in panel alone — the very panel `inlineFilters` replaces on a wide
 * screen. A range filter was therefore invisible on exactly the screens that
 * use it, which is what pushed Pedidos to hang its own inputs outside the grid.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InlineFilterChips, InlineFilterControls } from "../data-views-inline-bar";
import { rangeChipLabel } from "../data-views-range-values";
import type { RangeFieldConfig } from "../data-views-types";

interface Row extends Record<string, unknown> {
  day: string;
  amount: number;
}

const PERIOD: RangeFieldConfig<Row> = {
  id: "period",
  label: "Data",
  kind: "day",
  accessor: (row) => row.day,
};
const TOTAL: RangeFieldConfig<Row> = {
  id: "total",
  label: "Valor",
  unit: "R$",
  step: 0.01,
  accessor: (row) => row.amount,
};

/**
 * Nothing is measured in jsdom, so the bar is handed the "everything fits"
 * split — which is what `useFilterOverflow` returns without a ResizeObserver.
 */
const NO_COLLAPSE = {
  inline: [
    { id: "period", label: "Data", group: "range" as const, range: PERIOD },
    { id: "total", label: "Valor", group: "range" as const, range: TOTAL },
  ],
  overflow: [],
  compactControls: false,
  searchCollapsed: false,
  barRef: { current: null },
};

function renderBar(overrides: Partial<Parameters<typeof InlineFilterControls<Row>>[0]> = {}) {
  const onChangeRange = vi.fn();
  render(
    <InlineFilterControls<Row>
      split={NO_COLLAPSE}
      testIdPrefix="grid"
      search=""
      pills={{}}
      ranges={{}}
      onSearchChange={vi.fn()}
      onTogglePill={vi.fn()}
      onChangeRange={onChangeRange}
      onClearField={vi.fn()}
      {...overrides}
    />,
  );
  return { onChangeRange };
}

describe("InlineFilterControls — range pills", () => {
  it("renders one pill per range field, in the filter row", () => {
    renderBar();
    expect(screen.getByTestId("grid-range-period")).toHaveTextContent("Data");
    expect(screen.getByTestId("grid-range-total")).toHaveTextContent("Valor");
  });

  it("opens a popover with both bounds and reports each edit", () => {
    const { onChangeRange } = renderBar();
    fireEvent.click(screen.getByTestId("grid-range-period"));
    fireEvent.change(screen.getByTestId("grid-range-period-min"), {
      target: { value: "2026-07-01" },
    });
    expect(onChangeRange).toHaveBeenCalledWith("period", { min: "2026-07-01" });
  });

  it("keeps the OTHER bound when one end changes", () => {
    const { onChangeRange } = renderBar({ ranges: { period: { min: "2026-07-01" } } });
    fireEvent.click(screen.getByTestId("grid-range-period"));
    fireEvent.change(screen.getByTestId("grid-range-period-max"), {
      target: { value: "2026-07-31" },
    });
    expect(onChangeRange).toHaveBeenCalledWith("period", {
      min: "2026-07-01",
      max: "2026-07-31",
    });
  });

  it("clears a bound rather than writing NaN when a number is emptied", () => {
    const { onChangeRange } = renderBar({ ranges: { total: { min: 20 } } });
    fireEvent.click(screen.getByTestId("grid-range-total"));
    fireEvent.change(screen.getByTestId("grid-range-total-min"), { target: { value: "" } });
    expect(onChangeRange).toHaveBeenCalledWith("total", { min: undefined });
  });

  it("shows an applied window as ONE removable chip that drops both ends", () => {
    // The chips moved OFF the controls and onto their own row under the
    // toolbar, so they are rendered — and asserted — through their own
    // component rather than through the bar.
    const onChangeRange = vi.fn();
    render(
      <InlineFilterChips<Row>
        testIdPrefix="grid"
        search=""
        fields={[]}
        rangeFields={[PERIOD, TOTAL]}
        pills={{}}
        ranges={{ period: { min: "2026-07-01", max: "2026-07-31" } }}
        onSearchChange={vi.fn()}
        onTogglePill={vi.fn()}
        onChangeRange={onChangeRange}
        onClearAll={vi.fn()}
      />,
    );
    // The window now reads in TWO places — the pill itself and the active-chip
    // row — so the chip is addressed through its row rather than by its text.
    const chip = within(screen.getByTestId("grid-active-range:period")).getByText("Data: 01/07–31/07");
    expect(chip).toBeInTheDocument();
    // The chip's delete is its sibling ✕ — clearing the window, not one end.
    fireEvent.click(chip.parentElement?.querySelector("svg") as Element);
    expect(onChangeRange).toHaveBeenCalledWith("period", {});
  });

  it("also shows the window ON the pill, so the bar states what it is filtering", () => {
    renderBar({ ranges: { period: { min: "2026-07-01", max: "2026-07-31" } } });
    expect(screen.getByTestId("grid-range-period")).toHaveTextContent("Data: 01/07–31/07");
  });

  it("flags an inverted window instead of leaving an unexplained empty grid", () => {
    renderBar({ ranges: { period: { min: "2026-07-31", max: "2026-07-01" } } });
    fireEvent.click(screen.getByTestId("grid-range-period"));
    expect(screen.getByTestId("grid-range-period-inverted")).toHaveTextContent(
      "O início precisa ser menor que o fim.",
    );
  });

  it("says both days are included — the other half of FUT-668", () => {
    renderBar({ ranges: { period: { min: "2026-07-01", max: "2026-07-31" } } });
    fireEvent.click(screen.getByTestId("grid-range-period"));
    expect(screen.getByTestId("grid-range-period-inclusive")).toHaveTextContent(
      "Ambas as datas entram no resultado.",
    );
  });
});

describe("rangeChipLabel", () => {
  it("reads a two-sided window as a range", () => {
    expect(rangeChipLabel(PERIOD, { min: "2026-07-01", max: "2026-07-31" })).toBe(
      "Data: 01/07–31/07",
    );
  });

  it("reads a one-sided window as the inequality it is, not a blank end", () => {
    expect(rangeChipLabel(TOTAL, { min: 20 })).toBe("Valor: ≥ R$ 20");
    expect(rangeChipLabel(TOTAL, { max: 50 })).toBe("Valor: ≤ R$ 50");
  });
});
