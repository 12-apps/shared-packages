import { useCallback, useEffect, useRef, useState } from 'react';

import type { CarouselItem } from './Carousel.types';

interface CarouselNavigationInput {
  count: number;
  loop: boolean;
  autoPlay: boolean;
  autoPlayInterval: number;
  pauseOnHover: boolean;
  disabled: boolean;
  /** The slide shown first. Kept raw and clamped when read, so it survives a list that is still loading. */
  startIndex?: number;
  onChange?: (index: number) => void;
}

/**
 * Steps `current` by `step`, wrapping when `loop` allows it and stopping at the
 * end when it does not. Returns the same index it was given when there is
 * nowhere to go, which is what lets the caller skip a no-op `onChange`.
 */
const stepIndex = (current: number, step: number, count: number, loop: boolean) => {
  const next = current + step;

  if (next >= count) return loop ? 0 : current;
  if (next < 0) return loop ? count - 1 : 0;
  return next;
};

/**
 * Which slide is showing and everything that changes it: the arrows, an
 * indicator click, and the autoplay timer.
 *
 * Hover is tracked here rather than in the component because its only job is to
 * pause that timer.
 */
export const useCarouselNavigation = ({
  count,
  loop,
  autoPlay,
  autoPlayInterval,
  pauseOnHover,
  disabled,
  startIndex = 0,
  onChange,
}: CarouselNavigationInput) => {
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, Math.trunc(startIndex) || 0));
  const [isHovered, setIsHovered] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const goBy = useCallback(
    (step: number) => {
      setActiveIndex((raw) => {
        // The list may have shrunk since `raw` was set; step from what is shown.
        const prev = Math.min(raw, Math.max(0, count - 1));
        const next = stepIndex(prev, step, count, loop);
        if (next !== prev) {
          onChange?.(next);
        }
        return next;
      });
    },
    [count, loop, onChange],
  );

  const handleNext = useCallback(() => goBy(1), [goBy]);
  const handlePrev = useCallback(() => goBy(-1), [goBy]);

  const handleSelect = useCallback(
    (index: number) => {
      setActiveIndex(index);
      onChange?.(index);
    },
    [onChange],
  );

  useEffect(() => {
    if (!autoPlay || isHovered || disabled) return;

    intervalRef.current = window.setInterval(handleNext, autoPlayInterval);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
      }
    };
  }, [autoPlay, autoPlayInterval, isHovered, disabled, handleNext]);

  const hoverProps = {
    onMouseEnter: () => pauseOnHover && setIsHovered(true),
    onMouseLeave: () => pauseOnHover && setIsHovered(false),
  };

  // The list can shrink under the carousel; never point past its end.
  const shownIndex = Math.min(activeIndex, Math.max(0, count - 1));

  // Rotating means the timer is running; a screen reader should not be read every slide then.
  const rotating = autoPlay && count > 1 && !isHovered && !disabled;

  return { activeIndex: shownIndex, handleNext, handlePrev, handleSelect, hoverProps, rotating };
};

/**
 * A tap on a slide, reported unless the carousel is disabled, and its keyboard
 * twin: `onActivate` taps whichever slide is showing, and is absent when there
 * is nothing to report to.
 */
export const useItemClick = (
  disabled: boolean,
  items: CarouselItem[],
  activeIndex: number,
  onClick?: (item: CarouselItem, index: number) => void,
) => {
  const handleItemClick = useCallback(
    (item: CarouselItem, index: number) => {
      if (!disabled) onClick?.(item, index);
    },
    [disabled, onClick],
  );

  const active = items[activeIndex];
  const onActivate = onClick && !disabled && active ? () => onClick(active, activeIndex) : undefined;

  return { handleItemClick, onActivate };
};
