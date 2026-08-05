import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SPRING_CONFIG } from './Sheet.animations';
import { useDragGestures } from './Sheet.drag';
import type { SheetProps } from './Sheet.types';

export interface SheetDragInput {
  isDraggableVariant: boolean;
  isVerticalSheet: boolean;
  isBottomSheet: boolean;
  isTopSheet: boolean;
  snapPoints: number[];
  defaultSnapPoint: number;
  minSnapPoint: number;
  maxSnapPoint: number;
  velocityThreshold: number;
  dragResistance: number;
  animationConfig: NonNullable<SheetProps['animationConfig']>;
  onSnapPointChange?: (snapPoint: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (snapPoint: number) => void;
}

/**
 * Which snap point a drag ending at `position` should land on.
 *
 * A flick past the velocity threshold advances one point in the direction of
 * travel rather than landing on whichever is nearest — that is what makes a
 * short fast drag feel like a throw. Anything slower simply snaps to the
 * closest point.
 */
const closestSnapPoint = (
  points: number[],
  position: number,
  from: number,
  velocity: number,
  velocityThreshold: number,
) => {
  if (Math.abs(velocity) > velocityThreshold) {
    const index = points.findIndex((point) => Math.abs(point - from) < 0.01);

    if (velocity > 0 && index < points.length - 1) return points[index + 1];
    if (velocity < 0 && index > 0) return points[index - 1];
  }

  return points.reduce(
    (closest, point) =>
      Math.abs(position - point) < Math.abs(position - closest) ? point : closest,
    points[0] ?? from,
  );
};

/** Owns the panel element and the height writes that realise a snap point. */
const useSheetHeight = (input: Pick<SheetDragInput, 'isVerticalSheet' | 'isBottomSheet' | 'isTopSheet'>) => {
  const { isVerticalSheet, isBottomSheet, isTopSheet } = input;
  const [currentHeight, setCurrentHeight] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const updateSheetHeight = useCallback(
    (snapPoint: number) => {
      if (!sheetRef.current || !isVerticalSheet) return;

      const height = Math.round(window.innerHeight * snapPoint);

      if (isBottomSheet) {
        sheetRef.current.style.height = `${height}px`;
        sheetRef.current.style.transform = 'translateY(0)';
      } else if (isTopSheet) {
        sheetRef.current.style.height = `${height}px`;
      }

      setCurrentHeight(height);
    },
    [isBottomSheet, isTopSheet, isVerticalSheet],
  );

  return { sheetRef, currentHeight, updateSheetHeight };
};

interface SnapAnimationInput {
  isVerticalSheet: boolean;
  animationConfig: NonNullable<SheetProps['animationConfig']>;
  updateSheetHeight: (snapPoint: number) => void;
  onSettled: (snapPoint: number) => void;
  enabled: () => boolean;
}

/** The spring that carries the panel from one snap point to another. */
const useSnapAnimation = ({
  isVerticalSheet,
  animationConfig,
  updateSheetHeight,
  onSettled,
  enabled,
}: SnapAnimationInput) => {
  const [isAnimating, setIsAnimating] = useState(false);
  const animationFrameRef = useRef<number | undefined>(undefined);

  const animateToSnapPoint = useCallback(
    (from: number, to: number, velocity = 0) => {
      if (!enabled() || !isVerticalSheet) return;

      setIsAnimating(true);
      const distance = to - from;
      const startTime = globalThis.performance.now();

      const { tension, friction } = { ...SPRING_CONFIG, ...animationConfig };
      let currentVelocity = velocity * 1000; // px per second

      const animate = () => {
        const elapsed = (globalThis.performance.now() - startTime) / 1000;

        const springForce = -tension * (from - to);
        const dampingForce = -friction * currentVelocity;
        currentVelocity += (springForce + dampingForce) * 0.016; // 60fps timestep

        const progress = Math.min(1, elapsed * 4);
        updateSheetHeight(from + distance * progress);

        if (progress < 1) {
          animationFrameRef.current = window.requestAnimationFrame(animate);
          return;
        }

        setIsAnimating(false);
        onSettled(to);
        updateSheetHeight(to);
      };

      animate();
    },
    [isVerticalSheet, animationConfig, updateSheetHeight, onSettled, enabled],
  );

  const cancelAnimation = useCallback(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  return { isAnimating, animateToSnapPoint, cancelAnimation };
};

/**
 * Where the sheet rests and how it gets there. Knows nothing about pointers —
 * `useDragGestures` supplies the positions.
 */
const useSnapGeometry = (input: SheetDragInput) => {
  const {
    isVerticalSheet,
    snapPoints,
    defaultSnapPoint,
    minSnapPoint,
    maxSnapPoint,
    velocityThreshold,
    animationConfig,
    onSnapPointChange,
  } = input;

  const [currentSnapPoint, setCurrentSnapPoint] = useState(defaultSnapPoint);
  const { sheetRef, currentHeight, updateSheetHeight } = useSheetHeight(input);

  const sortedSnapPoints = useMemo(
    () =>
      [...snapPoints]
        .sort((a, b) => a - b)
        .filter((point) => point >= minSnapPoint && point <= maxSnapPoint),
    [snapPoints, minSnapPoint, maxSnapPoint],
  );

  const onSettled = useCallback(
    (snapPoint: number) => {
      setCurrentSnapPoint(snapPoint);
      onSnapPointChange?.(snapPoint);
    },
    [onSnapPointChange],
  );

  const hasPanel = useCallback(() => Boolean(sheetRef.current), [sheetRef]);

  const { isAnimating, animateToSnapPoint, cancelAnimation } = useSnapAnimation({
    isVerticalSheet,
    animationConfig,
    updateSheetHeight,
    onSettled,
    enabled: hasPanel,
  });

  const settleAt = useCallback(
    (position: number, velocity: number) => {
      const target = closestSnapPoint(
        sortedSnapPoints,
        position,
        currentSnapPoint,
        velocity,
        velocityThreshold,
      );
      if (target === undefined) return undefined;

      animateToSnapPoint(currentSnapPoint, target, velocity);
      return target;
    },
    [sortedSnapPoints, currentSnapPoint, velocityThreshold, animateToSnapPoint],
  );

  /** Re-seat the panel at its default snap point each time it opens. */
  const resetToDefaultSnapPoint = useCallback(() => {
    setCurrentSnapPoint(defaultSnapPoint);
    updateSheetHeight(defaultSnapPoint);
  }, [defaultSnapPoint, updateSheetHeight]);

  return {
    sheetRef,
    currentSnapPoint,
    currentHeight,
    isAnimating,
    updateSheetHeight,
    settleAt,
    resetToDefaultSnapPoint,
    cancelAnimation,
  };
};

export type SnapGeometry = ReturnType<typeof useSnapGeometry>;

/**
 * The draggable variant's whole state machine. It lives apart from the component
 * because none of it is about what the sheet renders — the component only needs
 * the ref to attach, the current height to size with, and the two flags that
 * suppress the CSS transition mid-drag.
 */
export const useSheetDrag = (input: SheetDragInput) => {
  const geometry = useSnapGeometry(input);
  const { isDragging, handleDragStart } = useDragGestures(input, geometry);

  return {
    sheetRef: geometry.sheetRef,
    currentHeight: geometry.currentHeight,
    isAnimating: geometry.isAnimating,
    resetToDefaultSnapPoint: geometry.resetToDefaultSnapPoint,
    isDragging,
    handleDragStart,
  };
};

interface SheetOpenInput {
  open: boolean;
  persistent: boolean;
  disabled: boolean;
  closeOnEscape: boolean;
  closeOnOverlayClick: boolean;
  isDraggableVariant: boolean;
  isVerticalSheet: boolean;
  resetToDefaultSnapPoint: () => void;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  onOpen?: () => void;
}

/**
 * Open/closed state and the three ways it changes: the `open` prop, the Escape
 * key, and a click on the overlay. `persistent` and `disabled` block every
 * close path, so they are checked once here rather than at each caller.
 */
export const useSheetOpen = (input: SheetOpenInput) => {
  const {
    open, persistent, disabled, closeOnEscape, closeOnOverlayClick,
    isDraggableVariant, isVerticalSheet, resetToDefaultSnapPoint,
    onOpenChange, onClose, onOpen,
  } = input;

  const [isOpen, setIsOpen] = useState(open);

  const handleClose = useCallback(() => {
    if (!persistent && !disabled) {
      setIsOpen(false);
      onOpenChange?.(false);
      onClose?.();
    }
  }, [persistent, disabled, onOpenChange, onClose]);

  const handleOverlayClick = useCallback(() => {
    if (closeOnOverlayClick && !persistent) {
      handleClose();
    }
  }, [closeOnOverlayClick, persistent, handleClose]);

  const handleSwipeOpen = useCallback(() => {
    setIsOpen(true);
    onOpenChange?.(true);
    onOpen?.();
  }, [onOpenChange, onOpen]);

  useEffect(() => {
    setIsOpen(open);
    if (open) {
      onOpen?.();
      if (isDraggableVariant && isVerticalSheet) {
        resetToDefaultSnapPoint();
      }
    }
  }, [open, onOpen, isDraggableVariant, isVerticalSheet, resetToDefaultSnapPoint]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: globalThis.KeyboardEvent) => {
      if (closeOnEscape && e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, closeOnEscape, handleClose]);

  return { isOpen, handleClose, handleOverlayClick, handleSwipeOpen };
};
