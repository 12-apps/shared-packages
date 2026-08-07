import type { ChartSpec } from "@12-apps/ui/charts";

import type { ReportRender, ReportTableColumn } from "./reports-api";

/**
 * A chart's data, described as table columns (FUT-391).
 *
 * Three surfaces need this same derivation — the "Ver como tabela" toggle, the
 * CSV export, and (through the toggle) the accessible fallback for anyone who
 * cannot read the chart at all. Deriving it in three places would let a column
 * appear on screen that is missing from the download, so it lives here and all
 * three call it.
 *
 * "Ver como tabela" is the REAL accessibility fallback for a chart. An
 * `aria-label` summarising a twelve-point series is a sentence nobody can hold
 * in their head; the same numbers as a table are navigable cell by cell, and
 * they are the numbers the chart was drawn from rather than a paraphrase.
 */

/**
 * `compact` is an AXIS affordance, not a data format: "1,5 mil" is not a number
 * anyone can read precisely or pivot on. A table exists to be read precisely,
 * so a compact axis becomes a decimal column.
 */
function columnFormat(chartSpec: ChartSpec): ReportTableColumn["format"] {
  const charted = chartSpec.numberFormat;
  return charted === "brl" || charted === "percent" || charted === "integer"
    ? charted
    : "decimal";
}

/**
 * The x-axis column, then one column per series — the reading order of the
 * chart itself, so someone switching between the two views is not re-learning
 * the layout.
 */
export function chartColumnsOf(
  render: Extract<ReportRender, { kind: "chart" }>,
): ReportTableColumn[] {
  // Prefer what the server shipped: it was built by the same code the table
  // presentation uses, so a column is named identically in both views. The
  // derivation below is the fallback for a payload predating FUT-391, and it
  // yields raw aliases — the x-axis no longer carries a title to read.
  return render.tableColumns ?? chartTableColumns(render.chartSpec);
}

export function chartTableColumns(chartSpec: ChartSpec): ReportTableColumn[] {
  const format = columnFormat(chartSpec);
  return [
    {
      key: chartSpec.xAxis.key,
      // A chart whose axis carries no label falls back to the key: the column
      // header is load-bearing here in a way the chart's axis was not, because
      // there is no shape beside it to make the meaning obvious.
      label: chartSpec.xAxis.label ?? chartSpec.xAxis.key,
      format: "text",
    },
    ...chartSpec.series.map((series) => ({
      key: series.key,
      label: series.label ?? series.key,
      format,
    })),
  ];
}
