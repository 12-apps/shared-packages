import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import Fade from '@mui/material/Fade/index.js';
import Slide from '@mui/material/Slide/index.js';
import Zoom from '@mui/material/Zoom/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import type { CSSObject } from '@mui/material/styles/index.js';
import React from 'react';

import { withDefaults } from '../../../utils/withDefaults';

import { useCarouselNavigation, useItemClick } from './Carousel.hooks';
import { useCarouselInteraction } from './Carousel.swipe';
import { CarouselChrome } from './Carousel.chrome';
import { CarouselIndicators } from './Carousel.parts';
import { CarouselTrack } from './Carousel.slide';
import { containerStyles, frameBox, interactionSx } from './Carousel.styles';
import type { CarouselItem, CarouselProps } from './Carousel.types';
import { muiColor } from '../../../tokens/scales';

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

const CarouselLoading: React.FC<{ sx: CSSObject; color: CarouselProps['color'] }> = ({ sx, color }) => (
  <Box sx={{ ...sx, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
    <CircularProgress color={muiColor(color ?? 'primary', 'inherit')} />
  </Box>
);

/**
 * With `indicatorPosition="below"` the frame and the dot row share a wrapper, so
 * the row sits outside the photo; otherwise the frame is returned as it is.
 */
const CarouselRow: React.FC<{ row: React.ReactNode; width: string; children: React.ReactNode }> = ({
  row, width, children,
}) => (row ? <Box sx={{ width }}>{children}{row}</Box> : <>{children}</>);

export const Carousel: React.FC<CarouselProps> = (props) => {
  const resolved = withDefaults(props, DEFAULTS) as ResolvedCarouselProps;
  const {
    items, variant, size, color, autoPlay, autoPlayInterval, loop, loading, disabled,
    className, style, height, width, pauseOnHover, onClick, onChange, onFocus, onBlur,
    animation, glow, pulse, glass, gradient, startIndex, copy,
  } = resolved;

  const theme = useTheme();

  const { activeIndex, handleNext, handlePrev, handleSelect, hoverProps } = useCarouselNavigation({
    count: items.length,
    loop,
    autoPlay,
    autoPlayInterval,
    pauseOnHover,
    disabled,
    startIndex,
    onChange,
  });

  const enabled = items.length > 1 && !disabled;
  const { interactive, reducedMotion, frameProps } = useCarouselInteraction({
    enabled, onPrev: handlePrev, onNext: handleNext,
  });

  const handleItemClick = useItemClick(disabled, onClick);

  const frameSx = containerStyles({
    theme, variant, size, color, glow, pulse, glass, gradient, ...frameBox(theme, size, height, width),
  });

  if (loading) {
    return <CarouselLoading sx={frameSx} color={color} />;
  }

  const below = resolved.indicatorPosition === 'below' && resolved.showIndicators && items.length > 1;

  return (
    <CarouselRow
      width={String(frameSx.width)}
      row={below && (
        <CarouselIndicators
          copy={copy} count={items.length} activeIndex={activeIndex} onSelect={handleSelect}
          position="below" color={color} variant={resolved.indicatorVariant}
        />
      )}
    >
    <Box
      className={className}
      data-testid="carousel-container"
      role="region"
      aria-roledescription={copy.roleDescription}
      aria-label={copy.region}
      tabIndex={interactive ? 0 : undefined}
      {...frameProps}
      sx={{ ...frameSx, ...interactionSx(theme, interactive), ...style }}
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
        timeout={reducedMotion ? 0 : 600}
        slideLabel={copy.slideLabel}
        slideRoleDescription={copy.slideRoleDescription}
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
    </CarouselRow>
  );
};
