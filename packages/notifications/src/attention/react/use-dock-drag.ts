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
    readonly onClickCapture: (event: MouseEvent<HTMLElement>) => void;
  };
}

export function useDockDrag(onMove: (position: AttentionDockPosition) => void): DockDrag {
  const drag = useRef<Drag | null>(null);
  const swallowClick = useRef(false);
  const [live, setLive] = useState<Live | null>(null);

  const follow = (event: PointerEvent<HTMLElement>, current: Drag): void => {
    const margin = EDGE_GAP_PX / 2;
    setLive({
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
    });
  };

  const settle = (current: Drag, at: Live): void => {
    swallowClick.current = true;
    const y = (at.top - EDGE_GAP_PX / 2) / Math.max(1, window.innerHeight - RESTING_SPAN_PX);
    const side = at.left + current.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    onMove({ side, y: clamp(y, 0, 1) });
  };

  return {
    live,
    handlers: {
      onPointerDown(event) {
        const box = event.currentTarget.getBoundingClientRect();
        drag.current = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
          moved: false,
        };
      },
      onPointerMove(event) {
        const current = drag.current;
        if (current === null) return;
        if (!current.moved) {
          if (
            Math.hypot(event.clientX - current.pointerX, event.clientY - current.pointerY) < DRAG_THRESHOLD_PX
          )
            return;
          current.moved = true;
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Older engines: the move still tracks while the pointer stays over us.
          }
        }
        follow(event, current);
      },
      onPointerUp() {
        const current = drag.current;
        drag.current = null;
        if (current !== null && current.moved && live !== null) settle(current, live);
        setLive(null);
      },
      onPointerCancel() {
        drag.current = null;
        setLive(null);
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
