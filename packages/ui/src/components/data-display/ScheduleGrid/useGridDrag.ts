import type * as React from 'react';
import { useCallback, useRef, useState } from 'react';

import { useDragWindow, useTrailingClick } from './drag-session';
import { canDrop, copyTargets, createTargets } from './schedule-grid-model';
import type { ScheduleGridCell } from './ScheduleGrid.types';

/** The gesture in progress, and where the pointer is now. */
export type GridDrag =
  | { mode: 'create'; rowId: string; anchor: number; day: number; moved: boolean }
  | { mode: 'copy'; rowId: string; blockId: string; preview: string; anchor: number; day: number; moved: boolean }
  | { mode: 'move'; blockId: string; fromRow: string; fromDay: number; rowId: string; day: number; moved: boolean };

interface DragHandlers {
  cell: (rowId: string, day: number) => ScheduleGridCell;
  onCreate?: (rowId: string, days: number[]) => void;
  onCopy?: (blockId: string, days: number[]) => void;
  onMove?: (blockId: string, toRowId: string, toDay: number) => void;
}

export interface GridDragApi {
  drag: GridDrag | null;
  /** Pointer down on an empty cell. */
  startCreate: (event: React.PointerEvent, rowId: string, day: number) => void;
  /** Pointer down on a block's edge grip. */
  startCopy: (event: React.PointerEvent, blockId: string, rowId: string, day: number, preview: string) => void;
  /** Pointer down on a block's middle. */
  startMove: (event: React.PointerEvent, blockId: string, rowId: string, day: number) => void;
  /** True once, for the click a finished drag leaves behind — the caller ignores that click. */
  takeClick: () => boolean;
}

/** A drag starts only for the primary button of a mouse or a pen: touch scrolls, and taps are clicks. */
function startsDrag(event: React.PointerEvent): boolean {
  return event.pointerType !== 'touch' && (event.button ?? 0) === 0;
}

/** The cell under a pointer event, from the `data-sg-*` attributes of the cell element. */
function cellUnder(target: EventTarget | null, root: HTMLElement | null): { rowId: string; day: number } | null {
  if (!(target instanceof Element) || !root) return null;
  const cell = target.closest<HTMLElement>('[data-sg-cell]');
  if (!cell || !root.contains(cell)) return null;
  const rowId = cell.dataset.sgRow;
  const day = Number(cell.dataset.sgDay);
  return rowId !== undefined && Number.isInteger(day) ? { rowId, day } : null;
}

/** A create drag: every crossed day that is open. A press in place is left to the "+"'s own click. */
function finishCreate(drag: Extract<GridDrag, { mode: 'create' }>, handlers: DragHandlers): boolean {
  if (!drag.moved) return false;
  const days = createTargets((day) => handlers.cell(drag.rowId, day), drag.anchor, drag.day);
  if (days.length > 0) handlers.onCreate?.(drag.rowId, days);
  return true;
}

/** A grip drag: the crossed days but the block's own. A grip pressed in place is not the block's click either. */
function finishCopy(drag: Extract<GridDrag, { mode: 'copy' }>, handlers: DragHandlers): boolean {
  const days = copyTargets((day) => handlers.cell(drag.rowId, day), drag.anchor, drag.day);
  if (days.length > 0) handlers.onCopy?.(drag.blockId, days);
  return true;
}

/** A middle drag: dropped on an open cell that is not its own. Not moved, it is the block's click. */
function finishMove(drag: Extract<GridDrag, { mode: 'move' }>, handlers: DragHandlers): boolean {
  if (!drag.moved) return false;
  const same = drag.rowId === drag.fromRow && drag.day === drag.fromDay;
  if (canDrop(handlers.cell(drag.rowId, drag.day), same)) handlers.onMove?.(drag.blockId, drag.rowId, drag.day);
  return true;
}

/** Report the finished gesture to the host. Returns whether the trailing click must be ignored. */
function finish(drag: GridDrag, handlers: DragHandlers): boolean {
  if (drag.mode === 'create') return finishCreate(drag, handlers);
  if (drag.mode === 'copy') return finishCopy(drag, handlers);
  return finishMove(drag, handlers);
}

/**
 * Click-and-drag on the week grid (FUT-3825): create across empty cells of one
 * row, copy a block along its row by an edge grip, move a block by its middle.
 *
 * Window listeners while a drag runs, so the pointer may leave the grid and
 * come back, and a release anywhere commits; the cell under the pointer comes
 * from the event's own target (a mouse is never captured, so it is the
 * element under the pointer). Escape, the window losing focus, or a move with
 * no button down abandons the drag: nothing is reported.
 */
export function useGridDrag(rootRef: React.RefObject<HTMLElement | null>, handlers: DragHandlers): GridDragApi {
  const [drag, setDrag] = useState<GridDrag | null>(null);
  const live = useRef<GridDrag | null>(null);
  const latest = useRef(handlers);
  latest.current = handlers;
  const click = useTrailingClick();

  const set = useCallback((next: GridDrag | null) => {
    live.current = next;
    setDrag(next);
  }, []);

  useDragWindow(drag !== null, {
    move: (event) => {
      const current = live.current;
      const under = cellUnder(event.target, rootRef.current);
      if (!current || !under) return;
      const rowId = current.mode === 'move' ? under.rowId : current.rowId;
      if (under.day === current.day && rowId === current.rowId) return;
      set({ ...current, rowId, day: under.day, moved: true } as GridDrag);
    },
    up: () => {
      const current = live.current;
      set(null);
      if (current && finish(current, latest.current)) click.arm(true);
    },
    // Abandoned: nothing reported, the ghost and the highlight gone. With the
    // button still down, the click its release leaves is not a click either.
    abort: (reason) => {
      set(null);
      if (reason === 'escape' || reason === 'blur') click.arm(false);
    },
  });

  const begin = (event: React.PointerEvent, next: GridDrag): void => {
    if (!startsDrag(event)) return;
    click.reset();
    set(next);
  };
  const startCreate = (event: React.PointerEvent, rowId: string, day: number): void =>
    begin(event, { mode: 'create', rowId, anchor: day, day, moved: false });
  const startCopy = (event: React.PointerEvent, blockId: string, rowId: string, day: number, preview: string): void => {
    event.stopPropagation();
    begin(event, { mode: 'copy', rowId, blockId, preview, anchor: day, day, moved: false });
  };
  const startMove = (event: React.PointerEvent, blockId: string, rowId: string, day: number): void =>
    begin(event, { mode: 'move', blockId, fromRow: rowId, fromDay: day, rowId, day, moved: false });

  return { drag, startCreate, startCopy, startMove, takeClick: click.take };
}
