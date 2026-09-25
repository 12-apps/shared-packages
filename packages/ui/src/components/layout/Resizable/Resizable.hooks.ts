import React, { useCallback, useRef, useState } from 'react';

import type { Bounds } from './Resizable.helpers';
import { resizedTo } from './Resizable.helpers';
import type { ResizeHandle } from './Resizable.types';

interface ResizeArgs {
  /** Where the box starts, in px (`startSizePx`); a new object re-seats the box. */
  start: { width: number; height: number };
  /** The clamp, in px (`axisPx` per axis). */
  bounds: Bounds;
  /** Rendered px per design px (`remPx(theme, 1)`) — `onResize` reports design px. */
  pxPerDesignPx: number;
  disabled: boolean;
  onResize?: (width: number, height: number) => void;
}

/**
 * Tracks the box's size across a drag. The listeners live on the document rather
 * than the handle, so the pointer can leave the handle — or the component — mid
 * drag without the resize sticking.
 *
 * The live size is px, because a drag is pointer pixels. What `onResize`
 * reports is design px — the unit the consumer's `width`/`height` are in — so a
 * controlled box (`onResize` feeding `width`) stays put at any type scale.
 */
export const useResize = ({ start, bounds, pxPerDesignPx, disabled, onResize }: ResizeArgs) => {
  const [size, setSize] = useState(start);
  const [isResizing, setIsResizing] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: 0, height: 0 });
  const activeHandle = useRef<ResizeHandle | null>(null);

  React.useEffect(() => {
    setSize(start);
  }, [start]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: ResizeHandle) => {
      if (disabled) return;

      e.preventDefault();
      e.stopPropagation();

      setIsResizing(true);
      activeHandle.current = handle;
      startPos.current = { x: e.clientX, y: e.clientY };
      // State is replaced on every change, never mutated, so holding it is a snapshot.
      startSize.current = size;

      const handleMouseMove = (move: globalThis.MouseEvent) => {
        const delta = {
          x: move.clientX - startPos.current.x,
          y: move.clientY - startPos.current.y,
        };
        const next = resizedTo(handle, delta, startSize.current, bounds);

        setSize(next);
        onResize?.(next.width / pxPerDesignPx, next.height / pxPerDesignPx);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        activeHandle.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [disabled, size, bounds, pxPerDesignPx, onResize],
  );

  return { size, isResizing, activeHandle, handleMouseDown };
};
