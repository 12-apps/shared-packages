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
