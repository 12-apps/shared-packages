/**
 * Range filters as pills in the INLINE filter bar (FUT-668).
 *
 * The bar used to render pills only, so `rangeFields` had a surface on the
 * slide-in panel alone — the very panel `inlineFilters` replaces on a wide
 * screen. A range filter was therefore invisible on exactly the screens that
 * use it, which is what pushed Pedidos to hang its own inputs outside the grid.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { InlineFilterBar } from "../data-views-inline-bar";
import { rangeChipLabel } from "../data-views-range-pill";
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

function renderBar(overrides: Partial<Parameters<typeof InlineFilterBar<Row>>[0]> = {}) {
  const onChangeRange = vi.fn();
  render(
    <InlineFilterBar<Row>
      testIdPrefix="grid"
      search=""
      fields={[]}
      rangeFields={[PERIOD, TOTAL]}
      pills={{}}
      ranges={{}}
      onSearchChange={vi.fn()}
      onTogglePill={vi.fn()}
      onChangeRange={onChangeRange}
      onClearField={vi.fn()}
      onClearAll={vi.fn()}
      {...overrides}
    />,
  );
  return { onChangeRange };
}

describe("InlineFilterBar — range pills", () => {
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
    const { onChangeRange } = renderBar({
      ranges: { period: { min: "2026-07-01", max: "2026-07-31" } },
    });
    const chip = screen.getByText("Data: 01/07–31/07");
    expect(chip).toBeInTheDocument();
    // The chip's delete is its sibling ✕ — clearing the window, not one end.
    fireEvent.click(chip.parentElement?.querySelector("svg") as Element);
    expect(onChangeRange).toHaveBeenCalledWith("period", {});
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
