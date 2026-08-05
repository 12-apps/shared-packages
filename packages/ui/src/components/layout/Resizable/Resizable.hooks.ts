import React, { useCallback, useRef, useState } from 'react';

import type { Bounds } from './Resizable.helpers';
import { resizedTo } from './Resizable.helpers';
import type { ResizeHandle } from './Resizable.types';

interface ResizeArgs {
  width: number;
  height: number;
  bounds: Bounds;
  disabled: boolean;
  onResize?: (width: number, height: number) => void;
}

/**
 * Tracks the box's size across a drag. The listeners live on the document rather
 * than the handle, so the pointer can leave the handle — or the component — mid
 * drag without the resize sticking.
 */
export const useResize = ({ width, height, bounds, disabled, onResize }: ResizeArgs) => {
  const [size, setSize] = useState({ width, height });
  const [isResizing, setIsResizing] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const startSize = useRef({ width: 0, height: 0 });
  const activeHandle = useRef<ResizeHandle | null>(null);

  React.useEffect(() => {
    setSize({ width, height });
  }, [width, height]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent, handle: ResizeHandle) => {
      if (disabled) return;

      e.preventDefault();
      e.stopPropagation();

      setIsResizing(true);
      activeHandle.current = handle;
      startPos.current = { x: e.clientX, y: e.clientY };
      startSize.current = { width: size.width, height: size.height };

      const handleMouseMove = (move: globalThis.MouseEvent) => {
        const delta = {
          x: move.clientX - startPos.current.x,
          y: move.clientY - startPos.current.y,
        };
        const next = resizedTo(handle, delta, startSize.current, bounds);

        setSize(next);
        onResize?.(next.width, next.height);
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
    [disabled, size, bounds, onResize],
  );

  return { size, isResizing, activeHandle, handleMouseDown };
};
