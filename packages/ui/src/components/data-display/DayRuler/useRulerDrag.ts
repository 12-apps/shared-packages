import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DAY_RULER_METRICS as M } from './DayRuler.metrics';
import { createdSpan, hourAt, moved, resized } from './day-ruler-model';
import type { DayRulerBlock, RulerHour } from './DayRuler.types';

type Mode = 'create' | 'move' | 'start' | 'end';

/** The gesture in progress: the block as it would land if released now. */
export interface RulerDrag {
  mode: Mode;
  rowId: string;
  /** Absent for a create. */
  blockId?: string;
  start: RulerHour;
  end: RulerHour;
  moved: boolean;
}

interface Origin {
  /** The track's box, read once when the drag starts (px from the viewport's left, and across). */
  boxStart: number;
  boxSize: number;
  /** The hour pressed. */
  anchor: RulerHour;
  /** The block's own hours before the drag (a create has none). */
  start: RulerHour;
  end: RulerHour;
}

interface Scale {
  from: RulerHour;
  to: RulerHour;
  snap: number;
  createHours: number;
}

interface RulerHandlers {
  onCreate?: (rowId: string, start: RulerHour, end: RulerHour) => void;
  onMove?: (blockId: string, start: RulerHour, end: RulerHour) => void;
  onResize?: (blockId: string, start: RulerHour, end: RulerHour) => void;
}

export interface RulerDragApi {
  drag: RulerDrag | null;
  /** Pointer down on a row's empty track. */
  startCreate: (event: React.PointerEvent<HTMLElement>, rowId: string) => void;
  /** Pointer down on a block's middle (`move`) or on one of its end handles. */
  startBlock: (event: React.PointerEvent<HTMLElement>, rowId: string, block: DayRulerBlock, mode: 'move' | 'start' | 'end') => void;
  /** True once, for the click a finished drag leaves behind. */
  takeClick: () => boolean;
}

/** A drag starts only for the primary button of a mouse or a pen: touch scrolls, and taps are clicks. */
function startsDrag(event: React.PointerEvent): boolean {
  return event.pointerType !== 'touch' && (event.button ?? 0) === 0;
}

/** The track an event happened on — a block's or a handle's included. */
function trackOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-dr-track]') : null;
}

/** The block where the pointer is now, from where the drag began. */
function next(drag: RulerDrag, origin: Origin, x: number, scale: Scale): RulerDrag {
  const h = hourAt(x, origin.boxStart, origin.boxSize, scale.from, scale.to, scale.snap);
  let span: [RulerHour, RulerHour];
  if (drag.mode === 'create') span = [Math.min(origin.anchor, h), Math.max(origin.anchor, h)];
  else if (drag.mode === 'move') span = moved(origin.start, origin.end, h - origin.anchor, scale.from, scale.to);
  else span = resized(origin.start, origin.end, drag.mode, h, M.minHours, scale.from, scale.to);
  const changed = span[0] !== drag.start || span[1] !== drag.end;
  return changed ? { ...drag, start: span[0], end: span[1], moved: true } : drag;
}

/** Report the finished gesture. Returns whether the trailing click must be ignored. */
function finish(drag: RulerDrag, origin: Origin, scale: Scale, handlers: RulerHandlers): boolean {
  if (drag.mode === 'create') {
    const [start, end] = createdSpan(drag.start, drag.end, M.minHours, scale.createHours, scale.to);
    handlers.onCreate?.(drag.rowId, start, end);
    return true;
  }
  const changed = drag.start !== origin.start || drag.end !== origin.end;
  if (drag.blockId && changed) {
    if (drag.mode === 'move') handlers.onMove?.(drag.blockId, drag.start, drag.end);
    else handlers.onResize?.(drag.blockId, drag.start, drag.end);
  }
  // A handle pressed in place is not the block's click; a block moved and
  // brought back is not one either.
  return drag.mode !== 'move' || drag.moved;
}

/**
 * Click-and-drag on the day ruler (FUT-3825): create on an empty track (a
 * click alone is `createHours`), slide a block by its middle, change its start
 * or end by its handles — every hour snapped to `snapMinutes` and kept on the
 * ruler. Window listeners while a drag runs; the hour comes from the pointer's
 * x over the track's box as it was when the drag started.
 */
export function useRulerDrag(scale: Scale, handlers: RulerHandlers): RulerDragApi {
  const [drag, setDrag] = useState<RulerDrag | null>(null);
  const live = useRef<{ drag: RulerDrag; origin: Origin } | null>(null);
  const latest = useRef({ scale, handlers });
  latest.current = { scale, handlers };
  const swallowClick = useRef(false);

  const set = useCallback((value: { drag: RulerDrag; origin: Origin } | null) => {
    live.current = value;
    setDrag(value?.drag ?? null);
  }, []);

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (event: PointerEvent): void => {
      const current = live.current;
      if (!current) return;
      const updated = next(current.drag, current.origin, event.clientX, latest.current.scale);
      if (updated !== current.drag) set({ drag: updated, origin: current.origin });
    };
    const onUp = (): void => {
      const current = live.current;
      set(null);
      if (current) swallowClick.current = finish(current.drag, current.origin, latest.current.scale, latest.current.handlers);
    };
    const onCancel = (): void => set(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [dragging, set]);

  const begin = (event: React.PointerEvent<HTMLElement>, value: Omit<RulerDrag, 'moved'>, block?: DayRulerBlock): void => {
    const track = trackOf(event.currentTarget);
    if (!track) return;
    const { left: boxStart, width: boxSize } = track.getBoundingClientRect();
    const { from, to, snap } = latest.current.scale;
    const anchor = hourAt(event.clientX, boxStart, boxSize, from, to, snap);
    const start = block ? block.start : anchor;
    const end = block ? block.end : anchor;
    swallowClick.current = false;
    set({
      drag: { ...value, start, end, moved: false },
      origin: { boxStart, boxSize, anchor, start, end },
    });
  };

  const startCreate = (event: React.PointerEvent<HTMLElement>, rowId: string): void => {
    if (!startsDrag(event) || event.target !== event.currentTarget) return;
    event.preventDefault();
    begin(event, { mode: 'create', rowId, start: 0, end: 0 });
  };
  const startBlock = (
    event: React.PointerEvent<HTMLElement>,
    rowId: string,
    block: DayRulerBlock,
    mode: 'move' | 'start' | 'end',
  ): void => {
    event.stopPropagation();
    if (!startsDrag(event)) return;
    begin(event, { mode, rowId, blockId: block.id, start: block.start, end: block.end }, block);
  };
  const takeClick = (): boolean => {
    const swallow = swallowClick.current;
    swallowClick.current = false;
    return swallow;
  };

  return { drag, startCreate, startBlock, takeClick };
}
