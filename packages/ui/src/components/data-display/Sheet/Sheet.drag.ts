import { useCallback, useEffect, useRef, useState } from 'react';

import type { SheetDragInput, SnapGeometry } from './Sheet.hooks';

type AnyPointerEvent =
  | React.MouseEvent
  | React.TouchEvent
  | globalThis.MouseEvent
  | globalThis.TouchEvent;

/** Reads the pointer's y from either a mouse or a touch event. */
export const clientYOf = (e: AnyPointerEvent) =>
  'touches' in e ? (e.touches[0]?.clientY ?? 0) : e.clientY;

/**
 * A drag continues wherever the pointer goes, so the move and end listeners
 * belong on the document rather than the panel.
 */
const useDragListeners = (
  isDragging: boolean,
  onMove: (e: globalThis.MouseEvent | globalThis.TouchEvent) => void,
  onEnd: (e: globalThis.MouseEvent | globalThis.TouchEvent) => void,
) => {
  useEffect(() => {
    if (!isDragging) return;

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
  }, [isDragging, onMove, onEnd]);
};

/**
 * Pointer velocity across a drag, in snap-point units per millisecond. Kept in
 * refs rather than state: it is read once at drag end and must not re-render
 * the panel on every pointer move.
 */
const useVelocityTracker = () => {
  const velocityRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);

  const begin = useCallback((clientY: number) => {
    lastYRef.current = clientY;
    lastTimeRef.current = globalThis.performance.now();
    velocityRef.current = 0;
  }, []);

  const track = useCallback((clientY: number) => {
    const now = globalThis.performance.now();
    const deltaTime = now - lastTimeRef.current;
    if (deltaTime > 0) {
      velocityRef.current = (clientY - lastYRef.current) / deltaTime;
    }
    lastYRef.current = clientY;
    lastTimeRef.current = now;
  }, []);

  const read = useCallback(() => velocityRef.current || 0, []);

  return { begin, track, read };
};

/**
 * The two conversions between pointer travel and snap points: how far a pointer
 * at `clientY` has moved the sheet, and what happens past the end stops.
 */
const useDragMath = (input: SheetDragInput, dragStartY: number) => {
  const { isBottomSheet, minSnapPoint, maxSnapPoint, dragResistance } = input;

  /** Snap-point delta for a pointer at `clientY`, sign-corrected for the anchor. */
  const snapDeltaFor = useCallback(
    (clientY: number) =>
      (isBottomSheet ? dragStartY - clientY : clientY - dragStartY) / window.innerHeight,
    [isBottomSheet, dragStartY],
  );

  /**
   * Past either end the sheet still moves, but only by a fraction of the drag,
   * so the boundary is felt rather than hit.
   */
  const withResistance = useCallback(
    (snapPoint: number) => {
      if (snapPoint < minSnapPoint) {
        return minSnapPoint - (minSnapPoint - snapPoint) * dragResistance;
      }
      if (snapPoint > maxSnapPoint) {
        return maxSnapPoint + (snapPoint - maxSnapPoint) * dragResistance;
      }
      return snapPoint;
    },
    [minSnapPoint, maxSnapPoint, dragResistance],
  );

  return { snapDeltaFor, withResistance };
};

interface InFlightInput {
  isDragging: boolean;
  dragStartY: number;
  stopDragging: () => void;
  velocity: ReturnType<typeof useVelocityTracker>;
}

/**
 * The two handlers that run while a drag is live: one per pointer move, and one
 * at release that hands the resting position to the geometry.
 */
const useDragInFlight = (
  input: SheetDragInput,
  geometry: SnapGeometry,
  { isDragging, dragStartY, stopDragging, velocity }: InFlightInput,
) => {
  const { isVerticalSheet, isBottomSheet, onDragEnd } = input;
  const { sheetRef, currentSnapPoint, updateSheetHeight, settleAt } = geometry;
  const { snapDeltaFor, withResistance } = useDragMath(input, dragStartY);

  const handleDragMove = useCallback(
    (e: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (!isDragging || !sheetRef.current || !isVerticalSheet) return;

      e.preventDefault();
      const clientY = clientYOf(e);
      velocity.track(clientY);
      updateSheetHeight(withResistance(currentSnapPoint + snapDeltaFor(clientY)));
    },
    [isDragging, sheetRef, isVerticalSheet, currentSnapPoint, snapDeltaFor, withResistance, updateSheetHeight, velocity],
  );

  const handleDragEnd = useCallback(
    (e: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (!isDragging || !isVerticalSheet) return;

      e.preventDefault();
      stopDragging();

      const position = currentSnapPoint + snapDeltaFor(clientYOf(e));
      // A bottom sheet grows as the pointer moves up, so its velocity reads
      // negative for the direction the panel is actually travelling.
      const finalVelocity = isBottomSheet ? -velocity.read() : velocity.read();

      const target = settleAt(position, finalVelocity);
      if (target !== undefined) {
        onDragEnd?.(target);
      }
    },
    [isDragging, isVerticalSheet, isBottomSheet, currentSnapPoint, snapDeltaFor, settleAt, stopDragging, velocity, onDragEnd],
  );

  return { handleDragMove, handleDragEnd };
};

/**
 * The pointer half of the draggable variant: tracks one drag from press to
 * release, converts its travel into a snap-point delta, and hands the result to
 * the geometry to settle.
 */
export const useDragGestures = (input: SheetDragInput, geometry: SnapGeometry) => {
  const { isDraggableVariant, isVerticalSheet, onDragStart } = input;
  const { isAnimating, cancelAnimation } = geometry;

  const [isDragging, setIsDragging] = useState(false);
  const [dragStartY, setDragStartY] = useState(0);
  const velocity = useVelocityTracker();

  const handleDragStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDraggableVariant || !isVerticalSheet || isAnimating) return;

      e.preventDefault();
      e.stopPropagation();

      const clientY = clientYOf(e);
      setIsDragging(true);
      setDragStartY(clientY);
      velocity.begin(clientY);

      cancelAnimation();
      onDragStart?.();
    },
    [isDraggableVariant, isVerticalSheet, isAnimating, velocity, cancelAnimation, onDragStart],
  );

  const stopDragging = useCallback(() => setIsDragging(false), []);
  const { handleDragMove, handleDragEnd } = useDragInFlight(input, geometry, {
    isDragging,
    dragStartY,
    stopDragging,
    velocity,
  });

  useDragListeners(isDragging, handleDragMove, handleDragEnd);

  return { isDragging, handleDragStart };
};
