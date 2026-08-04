/**
 * Shared renderers for a report's serializable render model (FUT-133):
 * charts go through `SpecChart` (semantic theme tokens, pt-BR formats) and
 * tables through `@12-apps/ui` Table with the model's format hints. Also owns
 * the CSV export-column derivation so on-screen data and the exported file
 * can never disagree.
 *
 * Value → text is NOT decided here: it comes from the package's `format`
 * module (FUT-454), which the server uses too, so the screen, the CSV and the
 * API's own metadata all render a duration, a percent or a SUPPRESSED cell
 * identically.
 */
import type { JSX } from "react";

import { SpecChart, type ChartDataPoint } from "@12-apps/ui/charts";
import { EmptyState } from "@12-apps/ui/data-display/EmptyState";
import { StatCard } from "@12-apps/ui/data-display/StatCard";
import { Table } from "@12-apps/ui/data-display/Table";

import { formatKpiFigure, formatReportValue } from "../format";
import type { ExportColumn } from "./lib/export-rows";
import type { ReportRender, ReportRow, ReportTableColumn } from "./reports-api";

/** Format one cell for display/export; `brl` values are integer centavos. */
function formatReportCell(
  value: ReportRow[string],
  format: ReportTableColumn["format"],
): string {
  return formatReportValue(value, format);
}

/** The KPI tile figure (FUT-309); a suppressed tile shows the same em-dash. */
function formatKpiValue(
  value: number | null,
  format: Extract<ReportRender, { kind: "kpi" }>["format"],
): string {
  return formatKpiFigure(value, format);
}

/** Export columns matching exactly what the render model displays. */
export function exportColumnsFor(render: ReportRender): ExportColumn<ReportRow>[] {
  if (render.kind === "table") {
    return render.columns.map((column) => ({
      header: column.label,
      value: (row) => formatReportCell(row[column.key] ?? null, column.format),
    }));
  }
  if (render.kind === "kpi") {
    return [{ header: render.label, value: () => formatKpiValue(render.value, render.format) }];
  }
  const charted = render.chartSpec.numberFormat;
  // `compact` is a chart-axis affordance, not an export format — a downloaded
  // "1,5 mil" is not a number anyone can pivot on, so it exports as a decimal.
  const numberFormat: ReportTableColumn["format"] =
    charted === "brl" || charted === "percent" || charted === "integer" ? charted : "decimal";
  return [
    {
      header: render.chartSpec.xAxis.label ?? render.chartSpec.xAxis.key,
      value: (row) => formatReportCell(row[render.chartSpec.xAxis.key] ?? null, "text"),
    },
    ...render.chartSpec.series.map((series) => ({
      header: series.label ?? series.key,
      value: (row: ReportRow) => formatReportCell(row[series.key] ?? null, numberFormat),
    })),
  ];
}

interface ReportRenderViewProps {
  render: ReportRender;
  dataTestId?: string;
}

/** The report body: KPI tile, chart, table, or an empty state without rows. */
export function ReportRenderView({
  render,
  dataTestId = "report-render",
}: ReportRenderViewProps): JSX.Element {
  if (render.kind === "kpi") {
    // A KPI over an empty period renders the tile with "—", not EmptyState —
    // in a dashboard grid the metric's absence should still say which metric.
    return (
      <div data-testid={dataTestId}>
        <StatCard
          label={render.label}
          value={formatKpiValue(render.value, render.format)}
          data-testid={`${dataTestId}-kpi`}
        />
      </div>
    );
  }
  if (render.rows.length === 0) {
    return (
      <EmptyState
        variant="minimal"
        title="Sem dados no período"
        description="Nenhum registro encontrado para o período selecionado."
        dataTestId={dataTestId}
      />
    );
  }
  if (render.kind === "chart") {
    return (
      <div data-testid={dataTestId}>
        <SpecChart
          spec={render.chartSpec}
          data={render.rows as unknown as ChartDataPoint[]}
          size="sm"
          data-testid={`${dataTestId}-chart`}
        />
      </div>
    );
  }
  return (
    <div data-testid={dataTestId}>
      <Table
        variant="striped"
        size="small"
        columns={render.columns.map((column) => ({
          key: column.key,
          label: column.label,
          align: column.format === "text" ? ("left" as const) : ("right" as const),
          render: (value: unknown) =>
            formatReportCell((value ?? null) as ReportRow[string], column.format),
        }))}
        data={render.rows}
        data-testid={`${dataTestId}-table`}
      />
    </div>
  );
}
