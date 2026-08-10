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
import { Box } from "@12-apps/ui/mui/Box";

import { formatKpiFigure, formatReportValue } from "../format";
import { chartColumnsOf } from "./chart-as-table";
import type { ExportColumn } from "./lib/export-rows";
import { SECTION_LABEL_STYLE } from "./lib/report-surface";
import type { ReportRender, ReportRow, ReportTableColumn } from "./reports-api";

/**
 * Every figure this file renders, in tabular figures.
 *
 * Nothing set `font-variant-numeric` anywhere, so a column of currency lined up
 * only because Roboto happens to ship uniform digit advances — a font swap in a
 * host's theme would have shredded it silently. It is declared once, on each
 * rendering's outermost box, and inherits into table cells, the KPI tile and
 * (SVG text inherits it too) the axis ticks.
 */
const TABULAR_FIGURES = { fontVariantNumeric: "tabular-nums" } as const;

/**
 * The chart's own box, and the two things it corrects in the chart library.
 *
 * **No shadow on a static card** (`visual-pass.md` §Depth). `SpecChart` renders
 * onto a MUI `Paper`, which arrives with elevation 1 — so a shadowed card sat
 * inside the bordered block card that already frames it. Shadows belong to
 * floating layers: menus, sheets, drag ghosts.
 *
 * **A large fill is never the accent at full strength.** A bar is ~150px of
 * solid `#6366f1` across a card, which dominates every other element on the
 * page including the controls that actually do something. Dropping the fill
 * short of opaque is the cheapest way to put it back behind the text, and it
 * costs the series nothing: the stroke and the legend swatch stay the accent.
 */
const CHART_BOX_SX = {
  ...TABULAR_FIGURES,
  // The radius itself comes from the page's surface, which rounds every
  // container to one value; importing it here would close a cycle back through
  // `report-grid`, which renders this file.
  "& .MuiPaper-root": { boxShadow: "none", backgroundImage: "none" },
  "& .recharts-bar-rectangle path, & .recharts-rectangle, & path.recharts-sector": {
    fillOpacity: 0.82,
  },
} as const;

/**
 * The product's table, restated over the design system's own defaults.
 *
 * `variant="striped"` was the divergence (FUT-755): it paints a zebra and
 * NOTHING else — the striped variant has no header treatment at all — so a
 * report table read as a bare grid beside every other list in the product.
 * Three independent sources agree on what the product's table IS, and not one
 * of them stripes:
 *
 *  - `apps/admin` renders every list through `DataViewsTableBase` →
 *    `@12-apps/ui` `DataGrid`: a header on `background.paper` with a
 *    `1px solid divider` rule beneath it, rows separated by the same rule,
 *    `palette.action.hover` on hover, and 36px rows (`DataViews` wires
 *    `density="compact" rowHeight={36} headerHeight={36}`).
 *  - `apps/super-admin/src/lib/table.tsx` — the `Th`/`Td` every platform list
 *    page is built from: a divider rule under the header AND under every row,
 *    the header label at caption size, weight 600, `text.secondary`.
 *  - `docs/reports-builder/prototype.html`, this redesign's own specification:
 *    `th{text-transform:uppercase;border-bottom:1px solid var(--line)}`,
 *    `td{border-bottom:1px solid var(--line-2)}`, `tbody tr:hover{…}`.
 *
 * The design system cannot express that through a variant. `default` tints the
 * header band `alpha(primary.main, 0.1)`, which nothing in the product does,
 * and the header's rule + weight are reachable only via `stickyHeader` — which
 * a block sized to its content cannot use, and which would also pin the header
 * at `zIndex: 100`. So the house style is restated here rather than changed
 * there: `packages/ui`'s `Table` is a shared component.
 *
 * Framing is deliberately NOT added. `ReportBlockFrame` already wraps every
 * rendering in an outlined `Card` on a tinted canvas, so a second border here
 * would double-frame it — the same reason `super-admin`'s `TableShell` and the
 * prototype's `.tbl-scroll` carry no border either. Horizontal overflow is
 * already handled: the DS renders its table inside a MUI `TableContainer`.
 *
 * Every selector is prefixed with `.MuiTable-root` on purpose. Without it the
 * head-background rule TIES the DS's own `.css-x .MuiTableHead-root` on
 * specificity and loses on insertion order — the parent `Box`'s class is
 * serialized first — so the primary tint would come back.
 */
const REPORT_TABLE_SX = {
  // Restated rather than inherited, so the table carries its own guarantee
  // wherever it is mounted. See TABULAR_FIGURES: a reporting requirement.
  ...TABULAR_FIGURES,
  "& .MuiTable-root .MuiTableHead-root": { backgroundColor: "transparent" },
  "& .MuiTable-root .MuiTableHead-root .MuiTableCell-root": {
    // The reports area already HAS one small-label treatment — the same one
    // "AGRUPAR POR" / "MEDIDAS" use. A column header is that kind of label, so
    // it reuses it instead of inventing a fifth step in the type ladder.
    ...SECTION_LABEL_STYLE,
    color: "text.secondary",
    borderBottom: "1px solid",
    borderBottomColor: "divider",
    // A wrapped column header re-flows the whole grid; the prototype's `th` is
    // `white-space:nowrap` for the same reason.
    whiteSpace: "nowrap",
  },
  "& .MuiTable-root .MuiTableBody-root .MuiTableCell-root": {
    borderBottom: "1px solid",
    borderBottomColor: "divider",
  },
  // Written out rather than passed as `hoverable`, which is the DS's own
  // hover: it tints with `alpha(primary.main, 0.08)` AND sets
  // `cursor: pointer`. A report row is not clickable, so a pointer cursor
  // promises an interaction that does not exist. `action.hover` is what
  // `DataGrid` uses on every admin list.
  "& .MuiTable-root .MuiTableBody-root .MuiTableRow-root:hover": {
    backgroundColor: "action.hover",
  },
} as const;

/**
 * One report table, in the product's style — rendered by BOTH call sites.
 *
 * A chart's "Ver como tabela" fallback showing a different table from a real
 * table block is the original bug one level down, so there is exactly one
 * component and the two callers cannot drift apart.
 */
function ReportTable({
  columns,
  rows,
  dataTestId,
}: {
  columns: readonly ReportTableColumn[];
  rows: ReportRow[];
  dataTestId: string;
}): JSX.Element {
  return (
    <Box sx={REPORT_TABLE_SX}>
      <Table
        // The design system's own documented default (`TABLE_DEFAULTS.variant`),
        // and the only variant that paints `background.paper`. That matters:
        // `SystemReportPage` renders a rendering with NO block card around it,
        // so a transparent table (`minimal`) would have no surface of its own
        // there. Inside a block card it is a no-op — the card is already paper.
        variant="default"
        // 36px rows — exactly what `DataViews` wires into every admin list.
        // It replaces `size="small"`, which did nothing at all: the DS sets
        // cell padding at `.css-x .MuiTableCell-root`, which outranks MUI's
        // own `.MuiTableCell-sizeSmall`, so the rows measured the 52px of
        // `density="normal"` however small the `size` said they were.
        density="compact"
        columns={columns.map((column) => ({
          key: column.key,
          label: column.label,
          // Numeric columns right, text left, derived from the column's
          // format. A reporting requirement, not a divergence: it is what
          // lets a reader compare magnitudes down a column at a glance.
          align: column.format === "text" ? ("left" as const) : ("right" as const),
          render: (value: unknown) =>
            formatReportCell((value ?? null) as ReportRow[string], column.format),
        }))}
        data={rows}
        data-testid={`${dataTestId}-table`}
      />
    </Box>
  );
}

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
  /**
   * Draw a CHART rendering as its table instead (FUT-755). A plain input, not
   * an internal mode: the control that flips it is an icon in the block's tool
   * cluster, which is a sibling of this rendering rather than a child, so the
   * state belongs to whoever renders both — `useBlockTableView` in
   * `lib/block-tools`. Keeping a fallback copy of it here would give every
   * consumer a controlled and an uncontrolled way to be wrong.
   */
  asTable?: boolean;
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
}: {
  render: Extract<ReportRender, { kind: "chart" }>;
  dataTestId: string;
  asTable: boolean;
}): JSX.Element {
  return (
    <Box sx={CHART_BOX_SX} data-testid={dataTestId}>
      {asTable ? (
        <ReportTable
          columns={chartColumnsOf(render)}
          rows={render.rows}
          dataTestId={dataTestId}
        />
      ) : (
        <SpecChart
          spec={render.chartSpec}
          data={render.rows as unknown as ChartDataPoint[]}
          size="sm"
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
}: ReportRenderViewProps): JSX.Element {
  if (render.kind === "kpi") {
    // A KPI over an empty period renders the tile with "—", not EmptyState —
    // in a dashboard grid the metric's absence should still say which metric.
    return (
      <Box sx={TABULAR_FIGURES} data-testid={dataTestId}>
        <StatCard
          label={render.label}
          value={formatKpiValue(render.value, render.format)}
          data-testid={`${dataTestId}-kpi`}
        />
      </Box>
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
    return <ChartOrTable render={render} dataTestId={dataTestId} asTable={asTable} />;
  }
  return (
    <Box sx={TABULAR_FIGURES} data-testid={dataTestId}>
      <ReportTable columns={render.columns} rows={render.rows} dataTestId={dataTestId} />
    </Box>
  );
}
