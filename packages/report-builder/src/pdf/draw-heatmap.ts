import { formatReportValue, SUPPRESSED_PLACEHOLDER } from '../format';
import type { ReportRenderModel } from '../render';
import type { PdfTableData } from './draw-table';
import type { PdfPaintContext } from './types';

type HeatmapModel = Extract<ReportRenderModel, { kind: 'heatmap' }>;

/**
 * A heat map on paper is its grid read as a table: the row labels down the
 * side, one column per axis value, each cell its figure at the measure's
 * format. The colour ramp is a screen idea; the figures are what an inbox needs.
 */
export function heatmapTable(ctx: PdfPaintContext, model: HeatmapModel): PdfTableData {
  const figures = new Map(
    model.cells.map((cell) => [
      `${cell.row}\u0000${cell.column}`,
      cell.value === null
        ? SUPPRESSED_PLACEHOLDER
        : formatReportValue(cell.value, model.valueFormat, ctx.values, model.valueDecimals),
    ]),
  );
  const columns = [
    { key: 'row', label: model.tableColumns[0]?.label ?? '', format: 'text' as const },
    ...model.columnAxis.map((axis, index) => ({
      key: `c${index}`,
      label: axis.label,
      format: 'text' as const,
      align: 'right' as const,
    })),
  ];
  const rows = model.rowAxis.map((axis) =>
    Object.fromEntries([
      ['row', axis.label],
      ...model.columnAxis.map((column, index) => [
        `c${index}`,
        figures.get(`${axis.key}\u0000${column.key}`) ?? SUPPRESSED_PLACEHOLDER,
      ]),
    ]),
  );
  return { columns, rows };
}
