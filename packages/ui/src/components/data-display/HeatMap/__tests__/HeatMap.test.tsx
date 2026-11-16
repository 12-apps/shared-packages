/**
 * FUT-4063: the heat map is a table a screen reader and a script can name
 * cell by cell, its sides are never colour alone, and it transposes.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createTheme } from "@mui/material/styles/index.js";

import { blend, decomposeColor, getContrastRatio, recomposeColor } from "../../../../tokens/color";
import { heatMapToneColors } from "../heat-map-colors";
import { HeatMap } from "../HeatMap";
import { heatMapFit, heatMapGrid, heatMapTone } from "../heat-map-model";
import type { HeatMapProps } from "../HeatMap.types";

afterEach(() => {
  cleanup();
});

const LABELS = { above: "acima da meta", below: "abaixo da meta", empty: "sem venda na hora" };
const SCALE = { target: 0.3, strongAbove: 0.45, strongBelow: 0.18 };

function renderHeatMap(overrides: Partial<HeatMapProps> = {}): void {
  render(
    <HeatMap
      rows={[
        { key: "1-seg", label: "Seg" },
        { key: "2-ter", label: "Ter" },
      ]}
      columns={[
        { key: "10", label: "10h" },
        { key: "11", label: "11h" },
        { key: "12", label: "12h" },
      ]}
      cells={[
        { row: "1-seg", column: "10", value: 0.58 },
        { row: "1-seg", column: "11", value: 0.31 },
        { row: "1-seg", column: "12", value: 0.1 },
        { row: "2-ter", column: "10", value: null },
        { row: "2-ter", column: "11", value: 0.2 },
      ]}
      scale={SCALE}
      formatValue={(value) => `${Math.round(value * 100)}%`}
      labels={LABELS}
      caption="Custo / vendas por dia da semana e hora"
      transpose={false}
      dataTestId="hm"
      {...overrides}
    />,
  );
}

describe("heatMapTone", () => {
  it("puts a value above the target on the attention side, deeper past strongAbove", () => {
    expect(heatMapTone(0.31, SCALE)).toBe("above");
    expect(heatMapTone(0.46, SCALE)).toBe("above-strong");
  });

  it("keeps a value AT the target on the calm side, deeper under strongBelow", () => {
    expect(heatMapTone(0.3, SCALE)).toBe("below");
    expect(heatMapTone(0.1, SCALE)).toBe("below-strong");
  });

  it("reads null as no figure, never as either side", () => {
    expect(heatMapTone(null, SCALE)).toBe("empty");
  });

  it("has no deeper step when the scale names none", () => {
    expect(heatMapTone(9, { target: 0.3 })).toBe("above");
    expect(heatMapTone(0, { target: 0.3 })).toBe("below");
  });
});

describe("heatMapGrid", () => {
  it("swaps the axes and keeps each cell's value when transposed", () => {
    const grid = heatMapGrid(
      [{ key: "r", label: "R" }],
      [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      [{ row: "r", column: "b", value: 2 }],
      true,
    );
    expect(grid.rows.map((row) => row.key)).toEqual(["a", "b"]);
    expect(grid.columns.map((column) => column.key)).toEqual(["r"]);
    expect(grid.cellAt("b", "r")?.value).toBe(2);
    expect(grid.cellAt("a", "r")).toBeUndefined();
  });
});

describe("HeatMap", () => {
  it("is a table named by its caption, with column and row headers", () => {
    renderHeatMap();
    const table = screen.getByRole("table", { name: "Custo / vendas por dia da semana e hora" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "10h",
      "11h",
      "12h",
    ]);
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual(["Seg", "Ter"]);
  });

  it("names an attention cell with its side's word and draws it bold", () => {
    renderHeatMap();
    const cell = screen.getByRole("cell", { name: "58% acima da meta" });
    expect(cell).toHaveAttribute("data-tone", "above-strong");
    expect(getComputedStyle(cell).fontWeight).toBe("700");
    expect(screen.getByTestId("hm-cell-1-seg-11")).toHaveAttribute("data-tone", "above");
  });

  it("draws a calm cell plain, with no side word", () => {
    renderHeatMap();
    const cell = screen.getByTestId("hm-cell-2-ter-11");
    expect(cell).toHaveTextContent(/^20%$/);
    expect(cell).toHaveAttribute("data-tone", "below");
  });

  it("shows a dash for a cell with no figure, and says why", () => {
    renderHeatMap();
    const cell = screen.getByTestId("hm-cell-2-ter-10");
    expect(cell).toHaveAttribute("data-tone", "empty");
    expect(cell).toHaveAccessibleName("— sem venda na hora");
  });

  it("leaves a cell nobody passed blank", () => {
    renderHeatMap();
    const cell = screen.getByTestId("hm-cell-2-ter-12");
    expect(cell).toHaveAttribute("data-tone", "blank");
    expect(cell).toBeEmptyDOMElement();
  });

  it("names every side in the legend", () => {
    renderHeatMap();
    const legend = screen.getByTestId("hm-legend");
    expect(legend).toHaveTextContent("abaixo da meta");
    expect(legend).toHaveTextContent("acima da meta");
    expect(legend).toHaveTextContent("— sem venda na hora");
  });

  it("draws no legend when asked not to", () => {
    renderHeatMap({ legend: false });
    expect(screen.queryAllByTestId("hm-legend")).toHaveLength(0);
  });

  it("transposes: the hours become rows and the weekdays columns, same cells", () => {
    renderHeatMap({ transpose: true });
    expect(screen.getByTestId("hm")).toHaveAttribute("data-transposed", "true");
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Seg", "Ter"]);
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      "10h",
      "11h",
      "12h",
    ]);
    expect(screen.getByTestId("hm-cell-1-seg-10")).toHaveTextContent("58%");
  });
});

describe("heatMapFit", () => {
  const metrics = { labelPx: 44, labelTransposedPx: 36, spacingPx: 3, minCellPx: 32, compactMinCellPx: 28 };

  it("keeps the asked orientation at the regular step when every figure fits", () => {
    expect(heatMapFit(560, 7, 14, metrics, false)).toEqual({ transposed: false, compact: false });
  });

  it("takes the compact step before turning the grid round", () => {
    // 14 hours in ~480px: 44 + 14 × 35 + 3 = 537 does not fit, 44 + 14 × 31 + 3 = 481 does.
    expect(heatMapFit(482, 7, 14, metrics, false)).toEqual({ transposed: false, compact: true });
  });

  it("turns 24 hours round at the owner's 1280-with-menu width rather than clip them", () => {
    expect(heatMapFit(546, 7, 24, metrics, false)).toEqual({ transposed: true, compact: false });
  });

  it("goes compact at 320 transposed, and keeps a fixed orientation", () => {
    expect(heatMapFit(250, 7, 14, metrics, true)).toEqual({ transposed: true, compact: true });
    expect(heatMapFit(546, 7, 24, metrics, false, true)).toEqual({ transposed: false, compact: true });
  });

  it("keeps the preference until the width is measured", () => {
    expect(heatMapFit(0, 7, 24, metrics, true)).toEqual({ transposed: true, compact: false });
  });
});

describe("heatMapToneColors reads at 4.5:1 in every palette and mode", () => {
  const palettes = {
    "MUI default light": createTheme({ palette: { mode: "light" } }),
    "MUI default dark": createTheme({ palette: { mode: "dark" } }),
    "host light": createTheme({ palette: { mode: "light", warning: { main: "#8C5908" }, primary: { main: "#C0392B" } } }),
    "host dark": createTheme({ palette: { mode: "dark", warning: { main: "#F5A623" }, primary: { main: "#C0392B" } } }),
  };
  const tones = ["above-strong", "above", "below-strong", "below", "empty"] as const;

  for (const [name, theme] of Object.entries(palettes)) {
    for (const tone of tones) {
      it(`${name}: ${tone}`, () => {
        const { backgroundColor, color } = heatMapToneColors(tone, theme);
        const ink = decomposeColor(color);
        // An ink with alpha is read where it sits: flattened onto its fill.
        const flat = ink.type.endsWith("a")
          ? blend(backgroundColor, recomposeColor({ type: "rgb", values: ink.values.slice(0, 3) }), ink.values[3] ?? 1)
          : color;
        expect(getContrastRatio(flat, backgroundColor)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("picks the role's light shade in a dark theme, never its dark one", () => {
    const theme = palettes["MUI default dark"];
    expect(heatMapToneColors("below", theme).color).not.toBe(theme.palette.info.dark);
  });
});
