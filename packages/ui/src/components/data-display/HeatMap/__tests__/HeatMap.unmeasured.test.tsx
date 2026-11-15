/**
 * FUT-4063, round two: a cell with no figure because its measure was never
 * taken (sales in the hour, no cost priced) is not "no sale in that hour".
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HeatMap } from "../HeatMap";
import type { HeatMapLabels } from "../HeatMap.types";

afterEach(() => {
  cleanup();
});

const LABELS: HeatMapLabels = { above: "acima da meta", below: "abaixo da meta", empty: "sem venda na hora" };

function renderGrid(labels: HeatMapLabels, unmeasured = true): void {
  render(
    <HeatMap
      rows={[{ key: "seg", label: "Seg" }]}
      columns={[
        { key: "10", label: "10h" },
        { key: "11", label: "11h" },
        { key: "12", label: "12h" },
      ]}
      cells={[
        { row: "seg", column: "10", value: null },
        { row: "seg", column: "11", value: null, ...(unmeasured ? { reason: "unmeasured" as const } : {}) },
        { row: "seg", column: "12", value: 0.2 },
      ]}
      scale={{ target: 0.3 }}
      formatValue={(value) => `${Math.round(value * 100)}%`}
      labels={labels}
      transpose={false}
      dataTestId="hm"
    />,
  );
}

describe("an unmeasured cell", () => {
  it("reads the host's unmeasured words, never the empty ones", () => {
    renderGrid({ ...LABELS, unmeasured: "sem custo na hora" });
    const cell = screen.getByTestId("hm-cell-seg-11");
    expect(cell.textContent).toBe("— sem custo na hora");
    expect(cell.getAttribute("data-tone")).toBe("empty");
    expect(cell.getAttribute("data-reason")).toBe("unmeasured");
    expect(screen.getByTestId("hm-cell-seg-10").textContent).toBe("— sem venda na hora");
  });

  it("carries a dashed ring, so the two dashes differ without words", () => {
    renderGrid({ ...LABELS, unmeasured: "sem custo na hora" });
    expect(getComputedStyle(screen.getByTestId("hm-cell-seg-11")).outlineStyle).toBe("dashed");
    expect(getComputedStyle(screen.getByTestId("hm-cell-seg-10")).outlineStyle).not.toBe("dashed");
  });

  it("adds its words to the legend while such a cell is drawn", () => {
    renderGrid({ ...LABELS, unmeasured: "sem custo na hora" });
    expect(screen.getByTestId("hm-legend-unmeasured").textContent).toBe("— sem custo na hora");
    expect(screen.getByTestId("hm-legend").textContent).toContain("— sem venda na hora");
  });

  it("reads its dash alone when the host gave no unmeasured words", () => {
    renderGrid(LABELS);
    expect(screen.getByTestId("hm-cell-seg-11").textContent).toBe("—");
    expect(screen.getByTestId("hm-legend").textContent).toBe("abaixo da metaacima da meta— sem venda na hora");
  });

  it("draws no extra legend entry when no cell is unmeasured", () => {
    renderGrid({ ...LABELS, unmeasured: "sem custo na hora" }, false);
    expect(screen.getByTestId("hm-legend").textContent).not.toContain("sem custo na hora");
    expect(screen.getByTestId("hm-cell-seg-11").hasAttribute("data-reason")).toBe(false);
  });
});
