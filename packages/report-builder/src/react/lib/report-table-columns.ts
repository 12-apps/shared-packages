/**
 * A report table's columns, as `@12-apps/ui`'s `Table` takes them — split out
 * of `report-render.tsx` (its 400-line gate) with the label floor (FUT-3167).
 */
import type { ColumnConfig } from "@12-apps/ui/data-display/Table";

import type { ValueFormatCopy } from "../../copy";
import { formatReportValue } from "../../format";
import type { ReportRow, ReportTableColumn } from "../reports-api";

/**
 * The least width, in design px, the row's label column keeps (FUT-3167).
 *
 * Every column used to size to its content, and the numeric ones never wrap
 * (their headers are `nowrap`, their figures one token), so the label got only
 * what they left: on the sales dashboard's per-product block, 90px at 900 and
 * next to nothing on a phone, stacking "TNT Energy Drink Maçã Verde" one word
 * per line. With a floor, a narrow block scrolls sideways inside the DS's
 * `TableContainer` instead of squeezing the one column a reader scans.
 */
const LABEL_COLUMN_MIN_WIDTH = 180;

/** The first text column is the row's label; only it gets the floor. */
function labelColumnKey(columns: readonly ReportTableColumn[]): string | undefined {
  return columns.find((column) => column.format === "text")?.key;
}

export function reportTableColumns(
  columns: readonly ReportTableColumn[],
  copy: ValueFormatCopy,
): ColumnConfig[] {
  const labelKey = labelColumnKey(columns);
  return columns.map((column) => ({
    key: column.key,
    label: column.label,
    // Numeric columns right, text left, derived from the column's format. A
    // reporting requirement, not a divergence: it is what lets a reader
    // compare magnitudes down a column at a glance.
    align: column.format === "text" ? ("left" as const) : ("right" as const),
    ...(column.key === labelKey ? { minWidth: LABEL_COLUMN_MIN_WIDTH } : {}),
    render: (value: unknown) => formatReportValue((value ?? null) as ReportRow[string], column.format, copy),
  }));
}
