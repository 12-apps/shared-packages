/**
 * The heat map presentation (FUT-4063), drawn by `@12-apps/ui`'s `HeatMap`.
 *
 * Everything it reads is in the render model: the axes the server ordered and
 * labelled, the cells, the target, and the host's words for the two sides. A
 * cell's figure is formatted by the package's own formatter — except that a
 * PERCENT is drawn whole here: a cell is a label in a narrow box, and its
 * precision lives in the CSV, which keeps the measure's own format.
 */
import type { JSX } from "react";

import { HeatMap } from "@12-apps/ui/data-display/HeatMap";

import { formatReportValue } from "../format";
import type { ReportHeatmapRender } from "./reports-api";
import { useReportEngineCopy } from "./transport-context";

const WHOLE_PERCENT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

export function ReportHeatmapView({
  render,
  caption,
  dataTestId,
}: {
  render: ReportHeatmapRender;
  /** The table's accessible name — the block's title, where it has one. */
  caption?: string;
  dataTestId: string;
}): JSX.Element {
  const copy = useReportEngineCopy();
  // A declared precision wins (FUT-4063); without one, a percent is drawn whole.
  const formatValue = (value: number): string =>
    render.valueDecimals === undefined && render.valueFormat === "percent"
      ? WHOLE_PERCENT.format(value)
      : formatReportValue(value, render.valueFormat, copy.values, render.valueDecimals);
  return (
    <HeatMap
      rows={render.rowAxis}
      columns={render.columnAxis}
      cells={render.cells}
      scale={render.scale}
      formatValue={formatValue}
      labels={render.labels}
      caption={caption}
      dataTestId={`${dataTestId}-heatmap`}
    />
  );
}
