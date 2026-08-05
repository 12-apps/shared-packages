import { Box, CircularProgress, Fade, Slide, useTheme, Zoom } from '@mui/material';
import React, { useCallback, useRef } from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { useCarouselNavigation } from './Carousel.hooks';
import { CarouselChrome } from './Carousel.chrome';
import { CarouselTrack } from './Carousel.slide';
import { containerStyles } from './Carousel.styles';
import type { CarouselItem, CarouselProps } from './Carousel.types';

export { CarouselArrows, CarouselIndicators, CarouselThumbnails } from './Carousel.parts';

const DEFAULTS = {
  variant: 'default',
  size: 'md',
  color: 'primary',
  autoPlay: false,
  autoPlayInterval: 3000,
  loop: true,
  showIndicators: true,
  showArrows: true,
  showThumbnails: false,
  glow: false,
  pulse: false,
  glass: false,
  gradient: false,
  loading: false,
  disabled: false,
  height: 400,
  width: '100%',
  pauseOnHover: true,
  indicatorPosition: 'bottom',
  arrowPosition: 'overlay',
  animation: 'slide',
} satisfies Partial<CarouselProps>;

type ResolvedCarouselProps = CarouselProps & Required<Pick<CarouselProps, keyof typeof DEFAULTS>>;

/**
 * `flip` reuses Slide with a fixed direction — MUI has no flip transition, and a
 * slide from one side reads closer to a flip than a fade does.
 */
const TRANSITIONS = { fade: Fade, zoom: Zoom, flip: Slide, slide: Slide } as const;

export const Carousel: React.FC<CarouselProps> = (props) => {
  const resolved = withDefaults(props, DEFAULTS) as ResolvedCarouselProps;
  const {
    items, variant, size, color, autoPlay, autoPlayInterval, loop, loading, disabled,
    className, style, height, width, pauseOnHover, onClick, onChange, onFocus, onBlur,
    animation, glow, pulse, glass, gradient,
  } = resolved;

  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  const { activeIndex, handleNext, handlePrev, handleSelect, hoverProps } = useCarouselNavigation({
    count: items.length,
    loop,
    autoPlay,
    autoPlayInterval,
    pauseOnHover,
    disabled,
    onChange,
  });

  const handleItemClick = useCallback(
    (item: CarouselItem, index: number) => {
      if (!disabled) {
        onClick?.(item, index);
      }
    },
    [disabled, onClick],
  );

  const frameSx = containerStyles({
    theme, variant, size, color, height, width, glow, pulse, glass, gradient,
  });

  if (loading) {
    return (
      <Box sx={{ ...frameSx, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <CircularProgress color={color} />
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      className={className}
      data-testid="carousel-container"
      sx={{ ...frameSx, ...style }}
      onFocus={onFocus}
      onBlur={onBlur}
      {...hoverProps}
    >
      <CarouselTrack
        items={items}
        activeIndex={activeIndex}
        variant={variant}
        animation={animation}
        transition={TRANSITIONS[animation] ?? Slide}
        clickable={Boolean(onClick)}
        onSelect={handleItemClick}
      />

      <CarouselChrome
        {...resolved}
        activeIndex={activeIndex}
        onPrev={handlePrev}
        onNext={handleNext}
        onSelect={handleSelect}
      />
    </Box>
  );
};
