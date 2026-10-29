import type * as React from 'react';

import type { ScheduleGridLabels } from './ScheduleGrid.labels';
import { isOpen, stepDay } from './schedule-grid-model';
import type { CellAbilities } from './ScheduleGrid.parts';
import type { ScheduleGridBlock, ScheduleGridCell, ScheduleGridColumn, ScheduleGridRow } from './ScheduleGrid.types';

/**
 * THE GRID'S KEYBOARD (FUT-3825). Every empty cell's "+" and every block is a
 * button in the tab order; on top of that:
 * - arrows move focus to the nearest focusable cell that way;
 * - Shift+←/→ on a copyable block copies it one day;
 * - Alt+←/→ on a movable block moves it one day (focus follows it);
 * either on a block that cannot do it says so (`notMovable`), a taken or
 * closed day is refused; each is read by the live region. With Ctrl or Meta
 * the key is not the grid's.
 */
export interface GridKeyContext {
  root: HTMLElement;
  rows: readonly ScheduleGridRow[];
  columns: readonly ScheduleGridColumn[];
  cell: (rowId: string, day: number) => ScheduleGridCell;
  can: CellAbilities;
  onCopy?: (blockId: string, days: number[]) => void;
  onMove?: (blockId: string, toRowId: string, toDay: number) => void;
  labels: ScheduleGridLabels;
  say: (text: string) => void;
  /** Wait for the block at its new day and focus it there. */
  follow: (blockId: string, day: number) => void;
}

/** Every focusable part of the grid (empty cells' buttons and blocks). */
export function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-sg-focus]'));
}

/** Focus the first focusable of the cell at (`rowId`, `day`); false when it has none. */
function focusCell(root: HTMLElement, rowId: string, day: number): boolean {
  const target = focusables(root).find((el) => el.dataset.sgRow === rowId && Number(el.dataset.sgDay) === day);
  target?.focus();
  return Boolean(target);
}

interface Arrow {
  horizontal: boolean;
  step: -1 | 1;
}

function arrowOf(key: string): Arrow | null {
  if (key === 'ArrowLeft') return { horizontal: true, step: -1 };
  if (key === 'ArrowRight') return { horizontal: true, step: 1 };
  if (key === 'ArrowUp') return { horizontal: false, step: -1 };
  if (key === 'ArrowDown') return { horizontal: false, step: 1 };
  return null;
}

/** Move focus `arrow`-wards to the nearest cell that has something to focus; a closed or read-only one is passed over. */
function moveFocus(ctx: GridKeyContext, from: HTMLElement, arrow: Arrow): boolean {
  const rowIndex = ctx.rows.findIndex((row) => row.id === from.dataset.sgRow);
  const day = Number(from.dataset.sgDay);
  if (rowIndex < 0) return false;
  for (let distance = 1; ; distance += 1) {
    const offset = arrow.step * distance;
    const nextDay = arrow.horizontal ? day + offset : day;
    const row = ctx.rows[arrow.horizontal ? rowIndex : rowIndex + offset];
    if (!row || nextDay < 0 || nextDay >= ctx.columns.length) return false;
    if (focusCell(ctx.root, row.id, nextDay)) return true;
  }
}

/** Which gesture a modified arrow asks of this block, if the grid allows it. */
function gestureOf(event: React.KeyboardEvent, block: ScheduleGridBlock, can: CellAbilities): 'copy' | 'move' | null {
  if (event.shiftKey && !event.altKey) return can.copy && block.copyable ? 'copy' : null;
  if (event.altKey && !event.shiftKey) return can.move && block.movable ? 'move' : null;
  return null;
}

/** The block a key landed on, with its row — or nothing. */
function blockUnder(ctx: GridKeyContext, el: HTMLElement): { block: ScheduleGridBlock; row: ScheduleGridRow; day: number } | null {
  const rowId = el.dataset.sgRow ?? '';
  const day = Number(el.dataset.sgDay);
  const block = ctx.cell(rowId, day).blocks.find((entry) => entry.id === el.dataset.sgBlock);
  const row = ctx.rows.find((entry) => entry.id === rowId);
  return block && row ? { block, row, day } : null;
}

/** The open day one step away, with its column — or nothing past either end or on a taken / closed day. */
function openNeighbour(ctx: GridKeyContext, rowId: string, day: number, step: -1 | 1) {
  const target = stepDay(day, step, ctx.columns.length);
  if (target === undefined) return null;
  const column = ctx.columns[target];
  return column && isOpen(ctx.cell(rowId, target)) ? { day: target, column } : null;
}

/**
 * Shift/Alt+←/→ on a block. Returns whether the key was the grid's: a block
 * that cannot be copied or moved that way refuses it aloud, and the key goes
 * no further (Alt+← would otherwise be the browser's Back).
 */
function blockKey(ctx: GridKeyContext, el: HTMLElement, event: React.KeyboardEvent, step: -1 | 1): boolean {
  const under = blockUnder(ctx, el);
  if (!under) return false;
  const gesture = gestureOf(event, under.block, ctx.can);
  const { block, row, day } = under;
  const target = gesture ? openNeighbour(ctx, row.id, day, step) : null;
  if (!gesture) {
    ctx.say(ctx.labels.notMovable);
  } else if (!target) {
    ctx.say(ctx.labels.refused);
  } else if (gesture === 'copy') {
    ctx.onCopy?.(block.id, [target.day]);
    ctx.say(ctx.labels.copied(block.label, target.column.label));
  } else {
    ctx.follow(block.id, target.day);
    ctx.onMove?.(block.id, row.id, target.day);
    ctx.say(ctx.labels.moved(block.label, row.label, target.column.label));
  }
  return true;
}

/** Shift OR Alt (not both) and no Ctrl or Meta: a key the grid answers for a block, as the ruler does. */
const isBlockGesture = (event: React.KeyboardEvent): boolean =>
  event.shiftKey !== event.altKey && !event.ctrlKey && !event.metaKey;

const hasModifier = (event: React.KeyboardEvent): boolean => event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;

/** The grid's `onKeyDown`. */
export function handleGridKey(event: React.KeyboardEvent, ctx: GridKeyContext): void {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-sg-focus]');
  const arrow = arrowOf(event.key);
  if (!el || !arrow) return;
  const onBlock = el.dataset.sgBlock !== undefined;
  if (onBlock && arrow.horizontal && isBlockGesture(event)) {
    if (blockKey(ctx, el, event, arrow.step)) event.preventDefault();
    return;
  }
  if (!hasModifier(event) && moveFocus(ctx, el, arrow)) event.preventDefault();
}
