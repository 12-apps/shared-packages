/**
 * The dock's drag: a press that travels six pixels becomes a drag, the dock
 * follows the pointer inside the screen, and on release it snaps to the nearer
 * side and reports where. The click a drag ends with is swallowed.
 */
import { useRef, useState, type MouseEvent, type PointerEvent } from 'react';

import type { AttentionDockPosition } from './preferences';

const DRAG_THRESHOLD_PX = 6;
/** The gap between the dock and the screen's edge. */
export const EDGE_GAP_PX = 16;
/** The button's height plus its margins: the part of the screen a stored height may not use. */
export const RESTING_SPAN_PX = 80;

interface Drag {
  readonly pointerX: number;
  readonly pointerY: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  moved: boolean;
}

interface Live {
  readonly left: number;
  readonly top: number;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

interface DockDrag {
  /** Where the dock is while being dragged; `null` at rest. */
  readonly live: Live | null;
  readonly handlers: {
    readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    readonly onPointerUp: () => void;
    readonly onPointerCancel: () => void;
    readonly onPointerLeave: () => void;
    readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  };
}

/**
 * How a dragged thing sits on the screen: how close to an edge it may come,
 * and the share of the screen's height it cannot rest in (its own height plus
 * those margins) — what a stored `y` is a fraction of the rest of.
 */
export interface DockFit {
  readonly margin: number;
  readonly span: number;
  /**
   * Take the pointer on the press itself rather than once it travels: for a
   * thing too thin to keep a mouse over it for six pixels (the folded tab). A
   * box with buttons INSIDE it must not, or their taps land on the box.
   */
  readonly captureOnPress?: boolean;
}

/** The dock's own fit: 8px from any edge, its 80px resting span. */
const DOCK_FIT: DockFit = { margin: EDGE_GAP_PX / 2, span: RESTING_SPAN_PX };

/** Where the pointer has taken the dock, kept inside the screen. */
function positionFor(event: PointerEvent<HTMLElement>, current: Drag, margin: number): Live {
  return {
    left: clamp(
      current.left + event.clientX - current.pointerX,
      margin,
      window.innerWidth - current.width - margin,
    ),
    top: clamp(
      current.top + event.clientY - current.pointerY,
      margin,
      window.innerHeight - current.height - margin,
    ),
  };
}

/** The drag starting: remember where the press and the dock were. */
function pressAt(event: PointerEvent<HTMLElement>): Drag {
  const box = event.currentTarget.getBoundingClientRect();
  return {
    pointerX: event.clientX,
    pointerY: event.clientY,
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    moved: false,
  };
}

/** Every later move of this pointer comes to us, wherever it goes. */
function capture(event: PointerEvent<HTMLElement>): void {
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // Older engines: the move still tracks while the pointer stays over us.
  }
}

/** Past the slop yet? On the first move that is, the drag takes the pointer. */
function crossedThreshold(event: PointerEvent<HTMLElement>, current: Drag): boolean {
  if (current.moved) return true;
  if (Math.hypot(event.clientX - current.pointerX, event.clientY - current.pointerY) < DRAG_THRESHOLD_PX) {
    return false;
  }
  current.moved = true;
  capture(event);
  return true;
}

/** Where a drag let go of the box, in px: its top-left corner, and the size it was pressed at. */
export interface DockDrop {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function useDockDrag(
  onMove: (position: AttentionDockPosition, drop: DockDrop) => void,
  { margin, span, captureOnPress = false }: DockFit = DOCK_FIT,
): DockDrag {
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  const [live, setLive] = useState<Live | null>(null);
  // The last position, read on release: a quick flick can end before the
  // render that would have put it in `live`.
  const latest = useRef<Live | null>(null);

  const reset = (): void => {
    drag.current = null;
    latest.current = null;
    setLive(null);
  };

  return {
    live,
    handlers: {
      onPointerDown(event) {
        // A new press: whatever the last drag armed is spent — a touch drag
        // ends without any click, so the flag must not outlive it.
        swallowClick.current = false;
        if (event.isPrimary === false || event.button !== 0) return;
        latest.current = null;
        drag.current = pressAt(event);
        if (captureOnPress) capture(event);
      },
      onPointerMove(event) {
        const current = drag.current;
        if (current === null || !crossedThreshold(event, current)) return;
        latest.current = positionFor(event, current, margin);
        setLive(latest.current);
      },
      onPointerUp() {
        const current = drag.current;
        const at = latest.current;
        reset();
        if (current === null || !current.moved || at === null) return;
        swallowClick.current = true;
        // The click a mouse drag ends with arrives in this same task; a touch
        // drag sends none, so the flag must not wait for one (a keyboard
        // activation later would be swallowed).
        window.setTimeout(() => {
          swallowClick.current = false;
        }, 0);
        const y = (at.top - margin) / Math.max(1, window.innerHeight - span);
        onMove(
          {
            side: at.left + current.width / 2 < window.innerWidth / 2 ? 'left' : 'right',
            y: clamp(y, 0, 1),
          },
          { left: at.left, top: at.top, width: current.width, height: current.height },
        );
      },
      onPointerCancel: reset,
      onPointerLeave() {
        // Let go outside before it became a drag: nothing is being held any more.
        // A press captured on the pointer is still held wherever the pointer is.
        if (drag.current !== null && !drag.current.moved && !captureOnPress) drag.current = null;
      },
      onClickCapture(event) {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        event.stopPropagation();
        event.preventDefault();
      },
    },
  };
}
