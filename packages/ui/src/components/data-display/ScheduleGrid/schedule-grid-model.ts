import type { ScheduleGridCell } from './ScheduleGrid.types';

/**
 * THE GRID'S RULES, as pure functions (FUT-3825): which days a gesture lands
 * on. The host decides everything else — hours, limits, refusals.
 */

/** A cell that can take a new turno: nothing in it, not closed to the row (`blocked`) and not gone (`closed`). */
export function isOpen(cell: ScheduleGridCell): boolean {
  return !cell.blocked && !cell.closed && cell.blocks.length === 0;
}

/** Every day from `a` to `b` inclusive, in order, whichever is larger. */
export function daysBetween(a: number, b: number): number[] {
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** A create across `anchor…current` of one row: the crossed days that are open (G-R1). */
export function createTargets(cellOf: (day: number) => ScheduleGridCell, anchor: number, current: number): number[] {
  return daysBetween(anchor, current).filter((day) => isOpen(cellOf(day)));
}

/** A copy of the block on `source` across `source…current`: never its own day, never a taken or closed one (G-R2). */
export function copyTargets(cellOf: (day: number) => ScheduleGridCell, source: number, current: number): number[] {
  return daysBetween(source, current).filter((day) => day !== source && isOpen(cellOf(day)));
}

/** A move may land on an open cell that is not its own (G-R3). */
export function canDrop(target: ScheduleGridCell, sameCell: boolean): boolean {
  return !sameCell && isOpen(target);
}

/** The day one step left (-1) or right (+1) of `day`, or `undefined` past either end. */
export function stepDay(day: number, direction: -1 | 1, dayCount: number): number | undefined {
  const next = day + direction;
  return next >= 0 && next < dayCount ? next : undefined;
}
