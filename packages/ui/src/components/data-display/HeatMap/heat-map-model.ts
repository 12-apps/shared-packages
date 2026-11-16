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
  /** The narrowest step: smallest type, thinnest gaps, labels every Nth. */
  dense: boolean;
}

/** The widths `heatMapFit` weighs, in px. */
export interface HeatMapFitMetrics {
  labelPx: number;
  labelTransposedPx: number;
  spacingPx: number;
  minCellPx: number;
  compactMinCellPx: number;
  /**
   * The dense step's own widths. `denseMinCellPx` is the MEASURED width of the
   * widest figure the dense step would draw, plus its margin; without it there
   * is no dense step (a host that gave no shorter figure never gets one).
   */
  denseLabelPx?: number;
  denseSpacingPx?: number;
  denseMinCellPx?: number;
}

function needs(columns: number, label: number, cell: number, spacing: number): number {
  return label + columns * (cell + spacing) + spacing;
}

/** The width one arrangement needs for its columns. */
function needed(fit: HeatMapFit, rowCount: number, columnCount: number, m: HeatMapFitMetrics): number {
  const columns = fit.transposed ? rowCount : columnCount;
  if (fit.dense) {
    return needs(columns, m.denseLabelPx ?? m.labelPx, m.denseMinCellPx ?? m.compactMinCellPx, m.denseSpacingPx ?? m.spacingPx);
  }
  return needs(
    columns,
    fit.transposed ? m.labelTransposedPx : m.labelPx,
    fit.compact ? m.compactMinCellPx : m.minCellPx,
    m.spacingPx,
  );
}

/**
 * The first arrangement in which EVERY figure shows whole (FUT-4063), so the
 * grid never clips a number and never scrolls sideways.
 *
 * Tried in order, in the preferred way round: the regular step, the compact
 * step, then (when the metrics name a measured one, and the grid is not
 * transposed) the dense step; only then the other way round at the same steps.
 * When nothing fits, the compact step of the preferred way round, as ever. So a computer width keeps its weekdays as rows
 * and its hours as columns for as long as the dense step can hold them, and a
 * phone container, too narrow even for that, turns round. `fixed` is true when
 * the host fixed the orientation (only the step can change then), else
 * `preferTransposed` is the preference (the phone prefers transposed). A width
 * of 0 (not yet measured, or no layout at all) keeps the preference at the
 * regular step.
 */
export function heatMapFit(
  width: number,
  rowCount: number,
  columnCount: number,
  metrics: HeatMapFitMetrics,
  preferTransposed: boolean,
  fixed = false,
): HeatMapFit {
  if (width <= 0) return { transposed: preferTransposed, compact: false, dense: false };
  const ways = fixed ? [preferTransposed] : [preferTransposed, !preferTransposed];
  const steps: Pick<HeatMapFit, 'compact' | 'dense'>[] = [
    { compact: false, dense: false },
    { compact: true, dense: false },
    ...(metrics.denseMinCellPx === undefined ? [] : [{ compact: true, dense: true }]),
  ];
  // Dense is only for the weekdays-as-rows way round: it exists to keep that
  // orientation at a computer width. A transposed grid (the phone) stays at
  // regular or compact, as it always did.
  const tries = ways.flatMap((transposed) =>
    steps.filter((step) => !(step.dense && transposed)).map((step) => ({ transposed, ...step })),
  );
  const fits = tries.find((attempt) => needed(attempt, rowCount, columnCount, metrics) <= width);
  return (
    fits ?? {
      transposed: fixed ? preferTransposed : rowCount <= columnCount,
      compact: true,
      dense: false,
    }
  );
}

/**
 * Every Nth column label to draw at the dense step: 1 while the widest label
 * (plus `gapPx` of air) fits one column's pitch, else as many columns as it
 * takes. Never by default: a label that fits is drawn.
 */
export function denseLabelEvery(
  width: number,
  columnCount: number,
  metrics: { labelPx: number; spacingPx: number; labelTextPx: number; gapPx: number },
): number {
  if (columnCount <= 0 || width <= 0) return 1;
  const pitch = (width - metrics.labelPx - metrics.spacingPx) / columnCount;
  if (pitch <= 0) return 1;
  return Math.max(1, Math.ceil((metrics.labelTextPx + metrics.gapPx) / pitch));
}
