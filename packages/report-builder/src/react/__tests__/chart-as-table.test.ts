import { describe, expect, it } from "vitest";

import { chartColumnsOf, chartTableColumns } from "../chart-as-table";
import type { ReportRender } from "../reports-api";

/**
 * FUT-391: the columns behind "Ver como tabela" and behind the CSV export are
 * ONE derivation. A column that appeared on screen but not in the download —
 * or vice versa — was the failure this consolidation removes.
 */

const spec = (patch: Record<string, unknown> = {}) =>
  ({
    xAxis: { key: "createdAt_day", label: "Data (dia)" },
    series: [{ key: "sum_totalCents", label: "Receita" }],
    numberFormat: "brl",
    ...patch,
  }) as Parameters<typeof chartTableColumns>[0];

describe("chartTableColumns", () => {
  it("puts the axis first, then one column per series", () => {
    expect(chartTableColumns(spec())).toEqual([
      { key: "createdAt_day", label: "Data (dia)", format: "text" },
      { key: "sum_totalCents", label: "Receita", format: "brl" },
    ]);
  });

  it("keeps the chart's reading order across several series", () => {
    const columns = chartTableColumns(
      spec({
        series: [
          { key: "pix", label: "PIX" },
          { key: "card", label: "Cartão" },
        ],
      }),
    );
    // Someone toggling between the two views should not re-learn the layout.
    expect(columns.map((column) => column.label)).toEqual(["Data (dia)", "PIX", "Cartão"]);
  });

  it("turns a compact axis into a decimal column", () => {
    // "1,5 mil" is an axis affordance. A table exists to be read precisely, and
    // a downloaded "1,5 mil" is not a number anyone can pivot on.
    const columns = chartTableColumns(spec({ numberFormat: "compact" }));
    expect(columns[1]?.format).toBe("decimal");
  });

  it("keeps a precise number format as it is", () => {
    for (const format of ["brl", "percent", "integer"] as const) {
      expect(chartTableColumns(spec({ numberFormat: format }))[1]?.format).toBe(format);
    }
  });

  it("falls back to the keys when the spec carries no labels", () => {
    // The header is load-bearing here in a way the chart's axis was not: there
    // is no shape beside it to make an unlabelled column's meaning obvious.
    const columns = chartTableColumns(
      spec({ xAxis: { key: "method" }, series: [{ key: "count_id" }] }),
    );
    expect(columns.map((column) => column.label)).toEqual(["method", "count_id"]);
  });

  it("always renders the axis as text, whatever the number format", () => {
    // The axis carries dates and category names; formatting it as a number
    // would render "2026-07-01" as NaN.
    expect(chartTableColumns(spec({ numberFormat: "integer" }))[0]?.format).toBe("text");
  });
});

describe("chartColumnsOf", () => {
  /**
   * Regression: removing the x-axis TITLE (it rendered over the tick labels)
   * left nothing on the ChartSpec to derive a column header from, so the table
   * fallback showed the raw alias — `createdAt_day` instead of "Data (dia)".
   * The server now ships the columns, built by the code the table presentation
   * already uses. Caught by the consumer harness, not by a unit test.
   */
  it("prefers the columns the server shipped", () => {
    const render = {
      kind: "chart",
      chartSpec: spec({ xAxis: { key: "createdAt_day" } }),
      tableColumns: [
        { key: "createdAt_day", label: "Data (dia)", format: "text" },
        { key: "sum_totalCents", label: "Receita", format: "brl" },
      ],
      rows: [],
    } as unknown as Extract<ReportRender, { kind: "chart" }>;

    expect(chartColumnsOf(render).map((column) => column.label)).toEqual([
      "Data (dia)",
      "Receita",
    ]);
  });

  it("falls back to the ChartSpec for a payload predating the field", () => {
    const legacy = {
      kind: "chart",
      chartSpec: spec(),
      rows: [],
    } as unknown as Extract<ReportRender, { kind: "chart" }>;

    expect(chartColumnsOf(legacy).map((column) => column.key)).toEqual([
      "createdAt_day",
      "sum_totalCents",
    ]);
  });
});
