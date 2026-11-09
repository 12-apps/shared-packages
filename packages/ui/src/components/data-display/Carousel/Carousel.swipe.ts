import useMediaQuery from '@mui/material/useMediaQuery/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { remPx } from '../../../tokens/relative';
import { classifySwipe, swipeAxis } from '../../../utils/swipe';

interface CarouselSwipeInput {
  enabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  /** Enter or Space on the focused frame: the keyboard's tap on the active slide. */
  onActivate?: () => void;
}

interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  at: number;
  /** Decided once, on the first move past the slop: `x` is ours, `y` is the page's. */
  axis: 'x' | 'y' | null;
}

/** How long after a drag its stray click is still swallowed. */
const DRAG_CLICK_WINDOW_MS = 300;

/**
 * The "this was a drag, not a tap" flag. On touch Chrome may send the click of a
 * short drag in a later task, so the flag outlives pointerup: until that click, a
 * new pointerdown or a key press clears it, or DRAG_CLICK_WINDOW_MS pass,
 * whichever comes first. There is ONE timer: an older gesture's must not clear a
 * newer gesture's flag, so `hold` and `clear` cancel it first, and so does unmount.
 */
const useDragFlag = () => {
  const flag = useRef(false);
  const timer = useRef<number | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const hold = useCallback(() => {
    cancel();
    timer.current = window.setTimeout(() => {
      flag.current = false;
      timer.current = null;
    }, DRAG_CLICK_WINDOW_MS);
  }, [cancel]);

  const clear = useCallback(() => {
    cancel();
    flag.current = false;
  }, [cancel]);

  return useMemo(() => ({ flag, hold, clear }), [hold, clear]);
};

/** Whether `event` is another finger than the one the gesture follows. */
const isOtherPointer = (event: React.PointerEvent, gesture: Gesture) =>
  event.isPrimary === false || event.pointerId !== gesture.pointerId;

/** A mouse leaving the frame mid-drag still ends the gesture on the frame. */
const capturePointer = (event: React.PointerEvent) => {
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId);
  } catch {
    /* a synthetic or already-released pointer: the gesture still works */
  }
};

/** A control the arrow keys already mean something in. */
const isEditable = (target: EventTarget): boolean => {
  const el = target as HTMLElement;
  if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return true;
  return el.getAttribute?.('role') === 'slider';
};

/**
 * Horizontal swipe for the carousel, on pointer events so one path serves a
 * finger, a pen and a mouse. The axis is decided on the first move past a small
 * slop: a vertical start is released to the page for good (the frame also sets
 * `touch-action: pan-y pinch-zoom`, so the browser keeps the vertical pan and
 * the pinch), a horizontal one is ours. How far counts as a swipe, and what a
 * fling is, come from the Lightbox's own `classifySwipe`. Only the first
 * pointer is followed; a second one drops the gesture.
 *
 * A drag past the slop, on either axis, is never a tap: the click that follows
 * it is swallowed in the capture phase, and the flag clears once the gesture ends.
 */
export const useCarouselSwipe = ({ enabled, onPrev, onNext }: CarouselSwipeInput) => {
  const theme = useTheme();
  const gestureRef = useRef<Gesture | null>(null);
  const drag = useDragFlag();
  const draggedRef = drag.flag;

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    drag.hold();
  }, [drag]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      drag.clear();
      if (event.isPrimary === false) {
        gestureRef.current = null;
        return;
      }
      if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
      gestureRef.current = {
        pointerId: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp, axis: null,
      };
    },
    [enabled, drag],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.axis || isOtherPointer(event, gesture)) return;

      const deltaX = event.clientX - gesture.x;
      const deltaY = event.clientY - gesture.y;
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < remPx(theme, 8)) return;

      gesture.axis = swipeAxis(deltaX, deltaY);
      draggedRef.current = true;
      if (gesture.axis === 'x') capturePointer(event);
    },
    [theme],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || isOtherPointer(event, gesture)) return;
      endGesture();
      if (gesture.axis !== 'x') return;

      const direction = classifySwipe({
        deltaX: event.clientX - gesture.x,
        deltaY: event.clientY - gesture.y,
        distance: remPx(theme, 50),
        elapsed: event.timeStamp - gesture.at,
      });

      if (direction === 'left') onNext();
      else if (direction === 'right') onPrev();
    },
    [theme, onNext, onPrev, endGesture],
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!draggedRef.current) return;
    draggedRef.current = false;
    event.stopPropagation();
    event.preventDefault();
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: endGesture, onClickCapture, clearDrag: drag.clear };
};

const ARROW_STEPS: Record<string, 'prev' | 'next'> = { ArrowLeft: 'prev', ArrowRight: 'next' };
const ACTIVATE_KEYS = new Set(['Enter', ' ']);

/**
 * Left and Right step the carousel while it, or a control inside it, has focus;
 * Enter and Space on the frame itself tap the active slide. The handler sits on
 * the frame, so there is no global listener, and a text field inside keeps its
 * own arrow keys.
 */
export const useCarouselKeys = ({ enabled, onPrev, onNext, onActivate }: CarouselSwipeInput) =>
  useCallback(
    (event: React.KeyboardEvent) => {
      if (event.defaultPrevented || isEditable(event.target)) return;

      const step = enabled ? ARROW_STEPS[event.key] : undefined;
      const tap = event.target === event.currentTarget && ACTIVATE_KEYS.has(event.key);
      const action = step ? (step === 'prev' ? onPrev : onNext) : tap && onActivate;
      if (!action) return;

      action();
      event.preventDefault();
    },
    [enabled, onPrev, onNext, onActivate],
  );

/**
 * Everything the frame listens to: swipe, keys, and the drag-ghost guard, plus
 * whether motion is reduced. A lone slide or a disabled carousel is not
 * swipeable and has no arrow keys; with `onActivate` it is still a tab stop, so
 * the keyboard can open what a tap opens.
 */
export const useCarouselInteraction = (input: CarouselSwipeInput) => {
  const { clearDrag, ...swipe } = useCarouselSwipe(input);
  const onKeys = useCarouselKeys(input);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const focusable = input.enabled || Boolean(input.onActivate);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      clearDrag();
      onKeys(event);
    },
    [clearDrag, onKeys],
  );

  const frameProps = {
    ...(input.enabled && swipe),
    ...(focusable && { onKeyDown }),
    ...(input.enabled && {
      // A dragged photo would otherwise start the browser's own image drag.
      onDragStart: (event: React.DragEvent) => event.preventDefault(),
    }),
  };

  return { interactive: input.enabled, focusable, reducedMotion, frameProps };
};
