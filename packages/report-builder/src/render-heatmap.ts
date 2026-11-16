/**
 * The heat map's render model (FUT-4063): the long rows a two-dimension query
 * returns, folded into the axes and cells `@12-apps/ui`'s `HeatMap` draws.
 *
 * Its own module, like `render-kpi.ts`: it is a branch of the renderer with a
 * shape of its own (two axes and a cell list) rather than columns over rows.
 */
import { requireEntityForRender } from './catalog';
import type { RenderLabelCopy } from './copy';
import type { ReportPresentation } from './spec';
import {
  isSuppressed,
  unmeasuredKey,
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

/**
 * One cell; `value: null` is an occurrence with no figure — a ratio over zero
 * ("no sale"), or, with `reason: 'unmeasured'`, a ratio whose denominator is
 * there but whose measure was never taken (sales, no cost priced).
 */
export interface ReportHeatmapCell {
  row: string;
  column: string;
  value: number | null;
  reason?: 'unmeasured';
}

export interface ReportHeatmapModel {
  kind: 'heatmap';
  rowAxis: ReportHeatmapAxisItem[];
  columnAxis: ReportHeatmapAxisItem[];
  cells: ReportHeatmapCell[];
  scale: { target: number; strongAbove?: number; strongBelow?: number };
  /** `unmeasured` only when some cell is unmeasured (FUT-4063). */
  labels: { above: string; below: string; empty: string; unmeasured?: string };
  /** How a cell's figure renders (the measure's format). */
  valueFormat: ReportValueFormat;
  /** The measure's declared fraction digits (FUT-4063); absent unless declared. */
  valueDecimals?: number;
  /** The long form, for CSV and "Ver como tabela": the dimensions, then the measure. */
  tableColumns: { key: string; label: string; format: ReportValueFormat; decimals?: number }[];
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
  // Numeric-aware: an hour axis without declared values reads 9h before 10h.
  const undeclared = [...present]
    .filter((value) => !declared.some((option) => option.value === value))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
  const unmeasured = value === null && row[unmeasuredKey(alias)] === true;
  return { row: rowKey, column: columnKey, value, ...(unmeasured ? { reason: 'unmeasured' as const } : {}) };
}

/**
 * Whether a cell shows activity (FUT-4063): a figure, or an unmeasured hour —
 * it SOLD, its cost was never priced. A null over no sale (an auto-closed
 * shift's night) is not activity, and is what an edge trim drops.
 */
function isActive(cell: ReportHeatmapCell): boolean {
  return cell.value !== null || cell.reason === 'unmeasured';
}

/**
 * An axis with its empty EDGES dropped (FUT-4063): the leading and trailing
 * items no cell shows activity in. What lies between the first and the last
 * active item stays, gaps included, so the axis is still contiguous — an
 * auto-closed shift that spread cost over the night (no sale, so no figure)
 * no longer stretches the hours to 0h–23h, while an hour that sold with no
 * cost priced (unmeasured) is kept.
 */
export function trimAxisEdges(axis: ReportHeatmapAxisItem[], active: ReadonlySet<string>): ReportHeatmapAxisItem[] {
  const first = axis.findIndex((item) => active.has(item.key));
  if (first < 0) return axis;
  let last = axis.length - 1;
  while (last > first && !active.has(axis[last]?.key ?? '')) last -= 1;
  return axis.slice(first, last + 1);
}

/**
 * The heat map's words: the presentation's, plus — only while a drawn cell is
 * unmeasured, so every other grid's model is unchanged — what such a cell
 * reads: the presentation's own, else the engine copy's neutral one.
 */
function heatmapLabels(
  labels: Extract<ReportPresentation, { kind: 'heatmap' }>['labels'],
  cells: ReportHeatmapCell[],
  copy: Pick<RenderLabelCopy, 'heatmapUnmeasured'>,
): ReportHeatmapModel['labels'] {
  const { unmeasured: own, ...base } = labels;
  const unmeasured = own ?? copy.heatmapUnmeasured;
  const needed = cells.some((cell) => cell.reason === 'unmeasured');
  return needed && unmeasured ? { ...base, unmeasured } : base;
}

/** The cells a trimmed grid still draws, and the axes with their empty edges dropped. */
function trimmed(
  rowAxis: ReportHeatmapAxisItem[],
  columnAxis: ReportHeatmapAxisItem[],
  cells: ReportHeatmapCell[],
  trim: 'rows' | 'columns' | 'both' | undefined,
): Pick<ReportHeatmapModel, 'rowAxis' | 'columnAxis' | 'cells'> {
  if (!trim) return { rowAxis, columnAxis, cells };
  const active = cells.filter(isActive);
  const rows = trim === 'columns' ? rowAxis : trimAxisEdges(rowAxis, new Set(active.map((cell) => cell.row)));
  const columns = trim === 'rows' ? columnAxis : trimAxisEdges(columnAxis, new Set(active.map((cell) => cell.column)));
  const rowKeys = new Set(rows.map((item) => item.key));
  const columnKeys = new Set(columns.map((item) => item.key));
  return {
    rowAxis: rows,
    columnAxis: columns,
    cells: cells.filter((cell) => rowKeys.has(cell.row) && columnKeys.has(cell.column)),
  };
}

export function toHeatmapModel(
  query: CompiledQuery,
  presentation: Extract<ReportPresentation, { kind: 'heatmap' }>,
  catalog: FieldCatalog,
  rows: ReportRow[],
  tableColumns: ReportHeatmapModel['tableColumns'],
  copy: Pick<RenderLabelCopy, 'heatmapUnmeasured'> = {},
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
  const grid = trimmed(
    heatmapAxis(entity.fields[rowDim.field], presentKeys(rows, rowDim)),
    heatmapAxis(entity.fields[columnDim.field], presentKeys(rows, columnDim)),
    cells,
    presentation.trimEdges,
  );
  return {
    kind: 'heatmap',
    ...grid,
    scale: {
      target: presentation.target,
      ...(presentation.strongAbove !== undefined ? { strongAbove: presentation.strongAbove } : {}),
      ...(presentation.strongBelow !== undefined ? { strongBelow: presentation.strongBelow } : {}),
    },
    labels: heatmapLabels(presentation.labels, grid.cells, copy),
    valueFormat: measure.format,
    ...(measure.decimals !== undefined ? { valueDecimals: measure.decimals } : {}),
    tableColumns,
    rows,
  };
}
