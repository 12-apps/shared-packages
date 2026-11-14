/**
 * The heat map's decisions as pure functions — the tone a value takes and the
 * transposed grid — so they are asserted without rendering.
 */
import type { HeatMapAxisItem, HeatMapCell, HeatMapScale, HeatMapTone } from './HeatMap.types';

/** Which side of the target a value sits on, and how far. */
export function heatMapTone(value: number | null, scale: HeatMapScale): HeatMapTone {
  if (value === null || !Number.isFinite(value)) return 'empty';
  if (value > scale.target) {
    return scale.strongAbove !== undefined && value > scale.strongAbove ? 'above-strong' : 'above';
  }
  return scale.strongBelow !== undefined && value < scale.strongBelow ? 'below-strong' : 'below';
}

/** Whether a tone is on the attention side. */
export function isAboveTone(tone: HeatMapTone): boolean {
  return tone === 'above' || tone === 'above-strong';
}

/** The grid as drawn: row items, column items and a lookup by `row|column`. */
export interface HeatMapGrid {
  rows: readonly HeatMapAxisItem[];
  columns: readonly HeatMapAxisItem[];
  cellAt: (row: string, column: string) => HeatMapCell | undefined;
}

function cellKey(row: string, column: string): string {
  return `${row}\u0000${column}`;
}

/**
 * The grid to draw, transposed or not. Transposing swaps the axes AND the
 * lookup, so a cell keeps its value whichever way it is read.
 */
export function heatMapGrid(
  rows: readonly HeatMapAxisItem[],
  columns: readonly HeatMapAxisItem[],
  cells: readonly HeatMapCell[],
  transposed: boolean,
): HeatMapGrid {
  const byKey = new Map<string, HeatMapCell>();
  for (const cell of cells) byKey.set(cellKey(cell.row, cell.column), cell);
  if (!transposed) {
    return { rows, columns, cellAt: (row, column) => byKey.get(cellKey(row, column)) };
  }
  return {
    rows: columns,
    columns: rows,
    cellAt: (row, column) => byKey.get(cellKey(column, row)),
  };
}

/** How the grid is drawn at a width: which way round, and at which type step. */
export interface HeatMapFit {
  transposed: boolean;
  compact: boolean;
}

/** The widths `heatMapFit` weighs, in px. */
export interface HeatMapFitMetrics {
  labelPx: number;
  labelTransposedPx: number;
  spacingPx: number;
  minCellPx: number;
  compactMinCellPx: number;
}

function needs(columns: number, label: number, cell: number, spacing: number): number {
  return label + columns * (cell + spacing) + spacing;
}

/**
 * The first arrangement in which EVERY figure shows whole (FUT-4063), so the
 * grid never clips a number and never scrolls sideways.
 *
 * Tried in order: as asked at the regular step, as asked at the compact step,
 * then the other way round at each step. `orientation` is `'rows'` or
 * `'columns'` when the host fixed it (only the step can change then), else the
 * preferred way round (the phone prefers transposed). A width of 0 (not yet
 * measured, or no layout at all) keeps the preference at the regular step.
 */
export function heatMapFit(
  width: number,
  rowCount: number,
  columnCount: number,
  metrics: HeatMapFitMetrics,
  preferTransposed: boolean,
  fixed = false,
): HeatMapFit {
  if (width <= 0) return { transposed: preferTransposed, compact: false };
  const ways = fixed ? [preferTransposed] : [preferTransposed, !preferTransposed];
  const tries: HeatMapFit[] = ways.flatMap((transposed) => [
    { transposed, compact: false },
    { transposed, compact: true },
  ]);
  const fits = tries.find(({ transposed, compact }) =>
    needs(
      transposed ? rowCount : columnCount,
      transposed ? metrics.labelTransposedPx : metrics.labelPx,
      compact ? metrics.compactMinCellPx : metrics.minCellPx,
      metrics.spacingPx,
    ) <= width,
  );
  return fits ?? { transposed: fixed ? preferTransposed : rowCount <= columnCount, compact: true };
}
