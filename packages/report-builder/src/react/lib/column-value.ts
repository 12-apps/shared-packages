/**
 * ONE cell's text, however a column says it reads (FUT-4063): a declared value
 * label ("Cozinha", not `k`), a host-formatted bucket ("Seg 03/11"), or the
 * value at its format and precision. The table, its phone cards and the CSV
 * all call this, so the three can never disagree about a cell.
 */
import type { ValueFormatCopy } from "../../copy";
import { formatReportValue } from "../../format";
import type { ReportGrain, ReportRow, ReportTableColumn } from "../reports-api";

/** The host's formatter for a dimension that names a `bucketFormat`. */
export type BucketFormatter = (value: string, options: { format: string; grain?: ReportGrain }) => string;

export function columnText(
  value: ReportRow[string] | undefined,
  column: Pick<ReportTableColumn, "format" | "decimals" | "valueLabels" | "bucketFormat" | "grain">,
  copy: ValueFormatCopy,
  formatBucket?: BucketFormatter,
): string {
  if (typeof value === "string" && column.valueLabels?.[value] !== undefined) return column.valueLabels[value];
  if (typeof value === "string" && column.bucketFormat !== undefined && formatBucket) {
    return formatBucket(value, { format: column.bucketFormat, ...(column.grain ? { grain: column.grain } : {}) });
  }
  return formatReportValue(value ?? null, column.format, copy, column.decimals);
}
