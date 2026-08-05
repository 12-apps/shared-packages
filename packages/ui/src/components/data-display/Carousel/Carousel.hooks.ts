import { useCallback, useEffect, useRef, useState } from 'react';

export interface CarouselNavigationInput {
  count: number;
  loop: boolean;
  autoPlay: boolean;
  autoPlayInterval: number;
  pauseOnHover: boolean;
  disabled: boolean;
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
  onChange,
}: CarouselNavigationInput) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const intervalRef = useRef<number | null>(null);

  const goBy = useCallback(
    (step: number) => {
      setActiveIndex((prev) => {
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

  return { activeIndex, handleNext, handlePrev, handleSelect, hoverProps };
};
