import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type React from 'react';
import { useCallback, useRef } from 'react';

import { remPx } from '../../../tokens/relative';
import { classifySwipe, swipeAxis } from '../../../utils/swipe';

interface CarouselSwipeInput {
  enabled: boolean;
  onPrev: () => void;
  onNext: () => void;
}

interface Gesture {
  x: number;
  y: number;
  at: number;
  /** Decided once, on the first move past the slop: `x` is ours, `y` is the page's. */
  axis: 'x' | 'y' | null;
}

/**
 * Horizontal swipe for the carousel, on pointer events so one path serves a
 * finger, a pen and a mouse. The axis is decided on the first move past a small
 * slop: a vertical start is released to the page for good (the frame also sets
 * `touch-action: pan-y`, so the browser keeps the vertical pan), a horizontal
 * one is ours. How far counts as a swipe, and what a fling is, come from the
 * Lightbox's own `classifySwipe`.
 *
 * A horizontal gesture, swipe or not, is a drag and never a tap: the click that
 * follows it is swallowed in the capture phase.
 */
export const useCarouselSwipe = ({ enabled, onPrev, onNext }: CarouselSwipeInput) => {
  const theme = useTheme();
  const gestureRef = useRef<Gesture | null>(null);
  const draggedRef = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      draggedRef.current = false;
      if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      gestureRef.current = { x: event.clientX, y: event.clientY, at: event.timeStamp, axis: null };
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.axis) return;

      const deltaX = event.clientX - gesture.x;
      const deltaY = event.clientY - gesture.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < remPx(theme, 8)) return;

      gesture.axis = swipeAxis(deltaX, deltaY);
      if (gesture.axis === 'x') {
        draggedRef.current = true;
        // A mouse leaving the frame mid-drag still ends the gesture here.
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          /* a synthetic or already-released pointer: the gesture still works */
        }
      }
    },
    [theme],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      gestureRef.current = null;
      if (!gesture || gesture.axis !== 'x') return;

      const direction = classifySwipe({
        deltaX: event.clientX - gesture.x,
        deltaY: event.clientY - gesture.y,
        distance: remPx(theme, 50),
        elapsed: event.timeStamp - gesture.at,
      });

      if (direction === 'left') onNext();
      else if (direction === 'right') onPrev();
    },
    [theme, onNext, onPrev],
  );

  const onPointerCancel = useCallback(() => {
    gestureRef.current = null;
  }, []);

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture };
};

/**
 * Left and Right step the carousel while it, or a control inside it, has focus:
 * the handler sits on the frame, so there is no global listener to leak.
 */
export const useCarouselKeys = ({ enabled, onPrev, onNext }: CarouselSwipeInput) =>
  useCallback(
    (event: React.KeyboardEvent) => {
      if (!enabled || event.defaultPrevented) return;
      if (event.key === 'ArrowLeft') onPrev();
      else if (event.key === 'ArrowRight') onNext();
      else return;
      event.preventDefault();
    },
    [enabled, onPrev, onNext],
  );

/**
 * Everything the frame listens to: swipe, keys, and the drag-ghost guard, plus
 * whether motion is reduced. `enabled` is false for a lone slide or a disabled
 * carousel, which then has no handlers and is not a tab stop.
 */
export const useCarouselInteraction = (input: CarouselSwipeInput) => {
  const swipe = useCarouselSwipe(input);
  const onKeyDown = useCarouselKeys(input);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const frameProps = input.enabled
    ? {
        ...swipe,
        onKeyDown,
        tabIndex: 0,
        // A dragged photo would otherwise start the browser's own image drag.
        onDragStart: (event: React.DragEvent) => event.preventDefault(),
      }
    : {};

  return { interactive: input.enabled, reducedMotion, frameProps };
};
