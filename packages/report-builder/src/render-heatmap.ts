/**
 * The heat map's render model (FUT-4063): the long rows a two-dimension query
 * returns, folded into the axes and cells `@12-apps/ui`'s `HeatMap` draws.
 *
 * Its own module, like `render-kpi.ts`: it is a branch of the renderer with a
 * shape of its own (two axes and a cell list) rather than columns over rows.
 */
import { requireEntityForRender } from './catalog';
import type { ReportPresentation } from './spec';
import {
  isSuppressed,
  type CompiledDimension,
  type CompiledQuery,
  type FieldCatalog,
  type FieldDef,
  type ReportRow,
  type ReportValueFormat,
} from './types';

/** One row or column of the grid: the stored value and the words it reads. */
export interface ReportHeatmapAxisItem {
  key: string;
  label: string;
}

/** One cell; `value: null` is an occurrence with no figure (a ratio over zero). */
export interface ReportHeatmapCell {
  row: string;
  column: string;
  value: number | null;
}

export interface ReportHeatmapModel {
  kind: 'heatmap';
  rowAxis: ReportHeatmapAxisItem[];
  columnAxis: ReportHeatmapAxisItem[];
  cells: ReportHeatmapCell[];
  scale: { target: number; strongAbove?: number; strongBelow?: number };
  labels: { above: string; below: string; empty: string };
  /** How a cell's figure renders (the measure's format). */
  valueFormat: ReportValueFormat;
  /** The long form, for CSV and "Ver como tabela": the dimensions, then the measure. */
  tableColumns: { key: string; label: string; format: ReportValueFormat }[];
  rows: ReportRow[];
}

function keyOf(raw: ReportRow[string] | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw);
}

/**
 * One axis, in the order it is drawn.
 *
 * A field that declares its closed set of `values` is drawn in THAT order and
 * CONTIGUOUS from its first to its last present value: an hour axis with work
 * at 10h and 14h shows 11h–13h as blank columns rather than closing the gap,
 * because a heat map read across a missing hour reads two hours as adjacent.
 * Without `values`, the present values in sorted order.
 */
export function heatmapAxis(field: FieldDef | undefined, present: ReadonlySet<string>): ReportHeatmapAxisItem[] {
  const declared = field?.values ?? [];
  const indices = declared
    .map((option, index) => (present.has(option.value) ? index : -1))
    .filter((index) => index >= 0);
  const undeclared = [...present].filter((value) => !declared.some((option) => option.value === value)).sort();
  const first = indices[0];
  const last = indices[indices.length - 1];
  const contiguous =
    first === undefined || last === undefined
      ? []
      : declared.slice(first, last + 1).map((option) => ({ key: option.value, label: option.label }));
  return [...contiguous, ...undeclared.map((value) => ({ key: value, label: value }))];
}

function presentKeys(rows: ReportRow[], dimension: CompiledDimension): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row[dimension.alias]);
    if (key !== null) keys.add(key);
  }
  return keys;
}

function toCell(row: ReportRow, rowDim: CompiledDimension, columnDim: CompiledDimension, alias: string): ReportHeatmapCell | null {
  const rowKey = keyOf(row[rowDim.alias]);
  const columnKey = keyOf(row[columnDim.alias]);
  if (rowKey === null || columnKey === null) return null;
  const raw = row[alias];
  // A suppressed figure is drawn as no figure, the rule every other branch follows.
  const value = typeof raw === 'number' && Number.isFinite(raw) && !isSuppressed(raw) ? raw : null;
  return { row: rowKey, column: columnKey, value };
}

export function toHeatmapModel(
  query: CompiledQuery,
  presentation: Extract<ReportPresentation, { kind: 'heatmap' }>,
  catalog: FieldCatalog,
  rows: ReportRow[],
  tableColumns: ReportHeatmapModel['tableColumns'],
): ReportHeatmapModel {
  const entity = requireEntityForRender(catalog, query.entity);
  const [rowDim, columnDim] = query.dimensions;
  const measure = query.measures[0];
  if (!rowDim || !columnDim || !measure) {
    // compileReport already rejects this; kept as a defensive invariant.
    throw new Error('Heatmap presentation requires two dimensions and one measure.');
  }
  const cells = rows
    .map((row) => toCell(row, rowDim, columnDim, measure.alias))
    .filter((cell): cell is ReportHeatmapCell => cell !== null);
  return {
    kind: 'heatmap',
    rowAxis: heatmapAxis(entity.fields[rowDim.field], presentKeys(rows, rowDim)),
    columnAxis: heatmapAxis(entity.fields[columnDim.field], presentKeys(rows, columnDim)),
    cells,
    scale: {
      target: presentation.target,
      ...(presentation.strongAbove !== undefined ? { strongAbove: presentation.strongAbove } : {}),
      ...(presentation.strongBelow !== undefined ? { strongBelow: presentation.strongBelow } : {}),
    },
    labels: presentation.labels,
    valueFormat: measure.format,
    tableColumns,
    rows,
  };
}
