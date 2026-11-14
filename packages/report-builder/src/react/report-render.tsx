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
import { Box } from "@12-apps/ui/mui/Box";

import type { ValueFormatCopy } from "../copy";
import { formatKpiFigure, formatReportValue } from "../format";

import { useReportCopy, useReportEngineCopy } from "./transport-context";
import { chartColumnsOf } from "./chart-as-table";
import type { ExportColumn } from "./lib/export-rows";
import {
  kpiFigures,
  type ReportKpiFigure,
  type ReportKpiFormat,
} from "./lib/kpi-figures";
import { CHART_BOX_SX, TABULAR_FIGURES } from "./lib/render-sx";
import { figureHints } from "./lib/report-notes";
import { ReportHeatmapView } from "./report-heatmap";
import { ReportTable } from "./report-table";
import { GRID_GAP_PX } from "./lib/report-surface";
import type {
  ReportNoteView,
  ReportRender,
  ReportRow,
  ReportTableColumn,
} from "./reports-api";

/** Format one cell for display/export; `brl` values are integer centavos. */
function formatReportCell(
  value: ReportRow[string],
  format: ReportTableColumn["format"],
  copy: ValueFormatCopy,
): string {
  return formatReportValue(value, format, copy);
}

/** The KPI tile figure (FUT-309); a suppressed tile shows the same em-dash. */
function formatKpiValue(value: number | null, format: ReportKpiFormat): string {
  return formatKpiFigure(value, format);
}

/**
 * A KPI block's figures, side by side (FUT-755).
 *
 * `Número` takes one or more measures now, and several figures in one block is
 * NOT a one-row table: each figure keeps its own caption ABOVE its own number,
 * which is the arrangement a table's header row cannot produce. The row wraps
 * rather than scrolling, so a narrow block stacks the figures instead of
 * truncating any — `flex: 1 1 <floor>` is what makes it wrap at a width where a
 * figure is still readable rather than at the container's edge.
 *
 * The first tile keeps `…-kpi`, the id from when a KPI block could only ever
 * hold one figure. The rest are added beside it as `…-kpi-1`, `…-kpi-2`.
 *
 * Through `dataTestId`, which is `StatCard`'s prop for it — NOT `data-testid`.
 * The hyphenated form is what was written here, and TypeScript does not
 * excess-check a hyphenated JSX attribute, so it type-checked, rendered
 * nothing, and left every tile carrying `StatCard`'s own default of
 * `stat-card`. Harmless while a KPI block held one figure; with three it put
 * the SAME id on three elements, which is a `getByTestId` that throws rather
 * than a query that misses.
 */
const KPI_FIGURE_MIN_PX = 132;

function KpiFigures({
  figures,
  dataTestId,
  hints,
}: {
  figures: ReportKpiFigure[];
  dataTestId: string;
  /** A figure's hint line, by index (FUT-4063) — e.g. "meta 30% · 2 dias acima". */
  hints?: ReadonlyMap<number, string>;
}): JSX.Element {
  return (
    <Box
      sx={{ ...TABULAR_FIGURES, display: "flex", flexWrap: "wrap", gap: `${GRID_GAP_PX}px` }}
      data-testid={dataTestId}
    >
      {figures.map((figure, index) => (
        <Box
          key={`${index}-${figure.label}`}
          sx={{ flex: `1 1 ${KPI_FIGURE_MIN_PX}px`, minWidth: 0 }}
        >
          <StatCard
            label={figure.label}
            value={formatKpiValue(figure.value, figure.format)}
            hint={hints?.get(index)}
            dataTestId={index === 0 ? `${dataTestId}-kpi` : `${dataTestId}-kpi-${index}`}
          />
        </Box>
      ))}
    </Box>
  );
}

/** Export columns matching exactly what the render model displays. */
export function exportColumnsFor(
  render: ReportRender,
  copy: ValueFormatCopy,
): ExportColumn<ReportRow>[] {
  if (render.kind === "table") {
    return render.columns.map((column) => ({
      header: column.label,
      value: (row) => formatReportCell(row[column.key] ?? null, column.format, copy),
    }));
  }
  if (render.kind === "heatmap") {
    // The long form the grid was folded from — one line per cell.
    return render.tableColumns.map((column) => ({
      header: column.label,
      value: (row: ReportRow) => formatReportCell(row[column.key] ?? null, column.format, copy),
    }));
  }
  if (render.kind === "kpi") {
    // One column per FIGURE — the download and the tile show the same numbers,
    // which stopped being one column the moment a KPI could carry several.
    return kpiFigures(render).map((figure) => ({
      header: figure.label,
      value: () => formatKpiValue(figure.value, figure.format),
    }));
  }
  // The SAME derivation "Ver como tabela" uses, so a column can never appear on
  // screen and be missing from the download.
  return chartColumnsOf(render).map((column) => ({
    header: column.label,
    value: (row: ReportRow) => formatReportCell(row[column.key] ?? null, column.format, copy),
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
  /**
   * Draw a CHART rendering as its table instead (FUT-755). A plain input, not
   * an internal mode: the control that flips it is an icon in the block's tool
   * cluster, which is a sibling of this rendering rather than a child, so the
   * state belongs to whoever renders both — `useBlockTableView` in
   * `lib/block-tools`. Keeping a fallback copy of it here would give every
   * consumer a controlled and an uncontrolled way to be wrong.
   */
  asTable?: boolean;
  /**
   * The block that holds this rendering has a chosen height (FUT-755), so the
   * rendering must take that height rather than its own intrinsic one.
   *
   * Off by default, and that is the compatibility rule: a block with no stored
   * height sizes itself by exactly what it draws, which is what every block
   * saved before `Altura` existed does.
   */
  fill?: boolean;
  /** Cap a table at ~10 rows and scroll it in place — see `lib/bounded-table`. */
  bounded?: boolean;
  /** A built-in's notes (FUT-4063); here only the KPI hints are read — `ReportNotes` draws the rest. */
  notes?: readonly ReportNoteView[];
  /** The heat map's accessible name (FUT-4063), usually the block's title. */
  caption?: string;
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
 * The table REPLACES the chart in the same box; nothing is stacked above or
 * below it, so switching costs the block only the difference between the two
 * renderings' own heights.
 */
function ChartOrTable({
  render,
  dataTestId,
  asTable,
  fill,
  bounded,
}: {
  render: Extract<ReportRender, { kind: "chart" }>;
  dataTestId: string;
  asTable: boolean;
  fill: boolean;
  bounded: boolean;
}): JSX.Element {
  return (
    <Box sx={CHART_BOX_SX} data-testid={dataTestId}>
      {asTable ? (
        <ReportTable
          columns={chartColumnsOf(render)}
          rows={render.rows}
          dataTestId={dataTestId}
          bounded={bounded}
        />
      ) : (
        <SpecChart
          spec={render.chartSpec}
          data={render.rows as unknown as ChartDataPoint[]}
          size="sm"
          // THE HALF THAT CSS CANNOT DO (FUT-755). Stretching the chart's
          // container is not enough: Recharts sizes the plot from the height
          // it was HANDED when that is a number, and only measures its own box
          // when it is a percentage. So a block set to `Alta` grew its card,
          // stretched the container, and drew the same 300px chart with the
          // rest of the block blank underneath — which is exactly what "alta
          // and media almost change nothing" described.
          fillHeight={fill}
          data-testid={`${dataTestId}-chart`}
        />
      )}
    </Box>
  );
}

/** The report body: KPI tile, chart, table, or an empty state without rows. */
export function ReportRenderView({
  render,
  dataTestId = "report-render",
  onWidenRange,
  asTable = false,
  fill = false,
  bounded = false,
  notes,
  caption,
}: ReportRenderViewProps): JSX.Element {
  const { ranges: rangeCopy, system: systemCopy } = useReportCopy().screens;
  if (render.kind === "kpi") {
    // A KPI over an empty period renders its tiles with "—", not EmptyState —
    // in a dashboard grid the metric's absence should still say which metric.
    return (
      <KpiFigures figures={kpiFigures(render)} dataTestId={dataTestId} hints={figureHints(notes, systemCopy)} />
    );
  }
  if (render.rows.length === 0) {
    return (
      <EmptyState
        variant="minimal"
        title={rangeCopy.emptyTitle}
        description={rangeCopy.emptyBody}
        primaryAction={onWidenRange}
        dataTestId={dataTestId}
      />
    );
  }
  if (render.kind === "heatmap") {
    return (
      <Box data-testid={dataTestId}>
        <ReportHeatmapView render={render} caption={caption} dataTestId={dataTestId} />
      </Box>
    );
  }
  if (render.kind === "chart") {
    return (
      <ChartOrTable render={render} dataTestId={dataTestId} asTable={asTable} fill={fill} bounded={bounded} />
    );
  }
  return (
    <Box sx={TABULAR_FIGURES} data-testid={dataTestId}>
      <ReportTable
        columns={render.columns}
        rows={render.rows}
        dataTestId={dataTestId}
        bounded={bounded}
        flag={render.flag}
      />
    </Box>
  );
}
