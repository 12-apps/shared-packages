/**
 * The report table (split out of `report-render.tsx`, FUT-4063): the product's
 * house style over the design system's `Table`, and a presentation's row flag.
 */
import type { JSX } from "react";

import { Table } from "@12-apps/ui/data-display/Table";
import { Box } from "@12-apps/ui/mui/Box";
import { useTheme } from "@12-apps/ui/mui/styles";
import { useMediaQuery } from "@12-apps/ui/mui/useMediaQuery";

import { BOUNDED_TABLE_SX } from "./lib/bounded-table";
import { TABULAR_FIGURES } from "./lib/render-sx";
import { reportTableColumns } from "./lib/report-table-columns";
import { SECTION_LABEL_STYLE } from "./lib/report-surface";
import { FLAGGED_ROW_SX, FlaggedCell, withFlagMarks } from "./lib/row-flag";
import { ReportTableCards } from "./report-table-cards";
import type { ReportPhoneCards, ReportRow, ReportTableColumn, ReportTableFlag } from "./reports-api";
import { useReportEngineCopy } from "./transport-context";

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
export function ReportTable({
  columns,
  rows,
  dataTestId,
  bounded = false,
  flag,
  phone,
}: {
  columns: readonly ReportTableColumn[];
  rows: ReportRow[];
  dataTestId: string;
  bounded?: boolean;
  /** The rows the presentation flags (FUT-4063): tinted, the judged cell marked. */
  flag?: ReportTableFlag;
  /** The opt-in phone form (FUT-4063): stacked cards below `md`, the table above. */
  phone?: ReportPhoneCards;
}): JSX.Element {
  const copy = useReportEngineCopy();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"), { noSsr: true });
  if (phone && narrow) {
    return <ReportTableCards columns={columns} rows={rows} phone={phone} flag={flag} dataTestId={dataTestId} />;
  }
  const flagged = flag
    ? { column: flag.column, render: (text: string) => <FlaggedCell text={text} label={flag.label} /> }
    : undefined;
  return (
    <Box sx={[REPORT_TABLE_SX, FLAGGED_ROW_SX, bounded ? BOUNDED_TABLE_SX : {}]}>
      <Table
        emptyText={copy.labels.emptyTable}
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
        columns={reportTableColumns(columns, copy.values, flagged)}
        data={withFlagMarks(rows, flag)}
        data-testid={`${dataTestId}-table`}
      />
    </Box>
  );
}
