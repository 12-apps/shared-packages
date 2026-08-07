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
import { useState, type JSX } from "react";

import { SpecChart, type ChartDataPoint } from "@12-apps/ui/charts";
import { EmptyState } from "@12-apps/ui/data-display/EmptyState";
import { StatCard } from "@12-apps/ui/data-display/StatCard";
import { Table } from "@12-apps/ui/data-display/Table";
import { Button } from "@12-apps/ui/form/Button";

import { formatKpiFigure, formatReportValue } from "../format";
import { chartColumnsOf } from "./chart-as-table";
import type { ExportColumn } from "./lib/export-rows";
import { NO_PRINT_CLASS } from "./lib/print-export";
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
  // The SAME derivation "Ver como tabela" uses, so a column can never appear on
  // screen and be missing from the download.
  return chartColumnsOf(render).map((column) => ({
    header: column.label,
    value: (row: ReportRow) => formatReportCell(row[column.key] ?? null, column.format),
  }));
}

interface ReportRenderViewProps {
  render: ReportRender;
  dataTestId?: string;
  /**
   * Offered by the empty state as "Ver 30 dias" (FUT-391). An empty block is
   * ambiguous — "nothing happened" and "your window is too small" look
   * identical — and the common cause is the window, so the state that reports
   * the emptiness also offers the fix. Omitted at the widest period, where the
   * offer could not be taken.
   */
  onWidenRange?: { label: string; onClick: () => void };
}

/**
 * A chart, with the same numbers one keystroke away as a table.
 *
 * This is the real accessibility fallback for a chart (FUT-391): an aria-label
 * summarising a twelve-point series is a sentence nobody can hold in their
 * head, while the same numbers as a table are navigable cell by cell. It is
 * also simply useful — reading an exact value off a chart is guesswork, and
 * this is the values the chart was drawn from rather than a paraphrase.
 *
 * The toggle is per block and NOT persisted: it is how someone wants to read
 * this block right now, not a property of the report. Saving it would change
 * what every other viewer sees.
 */
function ChartOrTable({
  render,
  dataTestId,
}: {
  render: Extract<ReportRender, { kind: "chart" }>;
  dataTestId: string;
}): JSX.Element {
  const [asTable, setAsTable] = useState(false);
  const columns = chartColumnsOf(render);

  return (
    <div data-testid={dataTestId}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAsTable((current) => !current)}
        aria-pressed={asTable}
        data-testid={`${dataTestId}-as-table`}
        className={NO_PRINT_CLASS}
      >
        {asTable ? "Ver como gráfico" : "Ver como tabela"}
      </Button>
      {asTable ? (
        <Table
          variant="striped"
          size="small"
          columns={columns.map((column) => ({
            key: column.key,
            label: column.label,
            align: column.format === "text" ? ("left" as const) : ("right" as const),
            render: (value: unknown) =>
              formatReportCell((value ?? null) as ReportRow[string], column.format),
          }))}
          data={render.rows}
          data-testid={`${dataTestId}-table`}
        />
      ) : (
        <SpecChart
          spec={render.chartSpec}
          data={render.rows as unknown as ChartDataPoint[]}
          size="sm"
          data-testid={`${dataTestId}-chart`}
        />
      )}
    </div>
  );
}

/** The report body: KPI tile, chart, table, or an empty state without rows. */
export function ReportRenderView({
  render,
  dataTestId = "report-render",
  onWidenRange,
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
        primaryAction={onWidenRange}
        dataTestId={dataTestId}
      />
    );
  }
  if (render.kind === "chart") {
    return <ChartOrTable render={render} dataTestId={dataTestId} />;
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
