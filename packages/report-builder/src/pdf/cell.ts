import { formatReportValue } from '../format';
import type { ReportTableColumn } from '../render';
import type { ReportRow } from '../types';
import type { PdfPaintContext } from './types';

export type CellColumn = Pick<ReportTableColumn, 'format' | 'decimals' | 'valueLabels' | 'bucketFormat' | 'grain'>;

/**
 * ONE cell's text, the way the screen and the CSV say it: a declared value
 * label first, then the host's bucket format, then the value at its format.
 */
export function cellText(value: ReportRow[string] | undefined, column: CellColumn, ctx: PdfPaintContext): string {
  if (typeof value === 'string' && column.valueLabels?.[value] !== undefined) return column.valueLabels[value];
  if (typeof value === 'string' && column.bucketFormat !== undefined && ctx.formatBucket) {
    return ctx.formatBucket(value, {
      format: column.bucketFormat,
      ...(column.grain ? { grain: column.grain } : {}),
    });
  }
  return formatReportValue(value ?? null, column.format, ctx.values, column.decimals);
}

export function isNumericFormat(format: ReportTableColumn['format']): boolean {
  return format !== 'text';
}
