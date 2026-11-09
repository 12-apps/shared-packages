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
import { CarouselBelow } from './Carousel.below';
import { CarouselTrack } from './Carousel.slide';
import { containerStyles, frameBox, interactionSx } from './Carousel.styles';
import type { CarouselCopy } from '../../../copy';
import type { CarouselProps } from './Carousel.types';
import { EN_US_CAROUSEL_COPY } from '../../../en-US.data-display';
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

/** Whether the dot row is drawn after the frame rather than on it. */
const isBelow = ({ items, showIndicators, indicatorPosition }: ResolvedCarouselProps) =>
  items.length > 1 && showIndicators && indicatorPosition === 'below';

/** What the chrome draws: arrows unless disabled, dots unless they went below. */
const chromeVisibility = ({ showArrows, showIndicators, disabled }: ResolvedCarouselProps, below: boolean) => ({
  showArrows: showArrows && !disabled,
  showIndicators: showIndicators && !below,
});

/** The counter's words: from the caller's pack, English when it omits them. */
const counterText = (copy: CarouselCopy, show: boolean, position: number, total: number) =>
  show ? (copy.position ?? EN_US_CAROUSEL_COPY.position)(position, total) : undefined;

/** The frame's accessible shape: a named carousel region, and a tab stop when it can be driven. */
const frameA11y = (copy: CarouselCopy, focusable: boolean) => ({
  role: 'region',
  'aria-roledescription': copy.roleDescription,
  'aria-label': copy.region,
  tabIndex: focusable ? 0 : undefined,
});

export const Carousel: React.FC<CarouselProps> = (props) => {
  const resolved = withDefaults(props, DEFAULTS) as ResolvedCarouselProps;
  const {
    items, variant, size, color, loading, disabled, className, style, height, width, onClick,
    onFocus, onBlur, animation, glow, pulse, glass, gradient, copy,
  } = resolved;

  const theme = useTheme();
  const nav = useCarouselNavigation({ ...resolved, count: items.length });
  const { activeIndex, handleNext, handlePrev, handleSelect, hoverProps } = nav;
  const { handleItemClick, onActivate } = useItemClick(disabled, items, activeIndex, onClick);

  const { interactive, focusable, reducedMotion, frameProps } = useCarouselInteraction({
    enabled: items.length > 1 && !disabled,
    onPrev: handlePrev,
    onNext: handleNext,
    onActivate,
  });

  const frameSx = containerStyles({
    theme, variant, size, color, glow, pulse, glass, gradient, ...frameBox(theme, size, height, width),
  });

  if (loading) return <CarouselLoading sx={frameSx} color={color} />;

  const below = isBelow(resolved);

  return (
    <CarouselBelow
      show={below}
      width={String(frameSx.width)}
      indicators={{ copy, count: items.length, activeIndex, onSelect: handleSelect, color, variant: resolved.indicatorVariant }}
    >
      <Box
        className={className}
        data-testid="carousel-container"
        {...frameA11y(copy, focusable)}
        {...frameProps}
        sx={{ ...frameSx, ...interactionSx(theme, interactive, focusable), ...style }}
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
          live={nav.rotating ? 'off' : 'polite'}
          slideLabel={copy.slideLabel}
          slideRoleDescription={copy.slideRoleDescription}
          clickable={Boolean(onClick)}
          onSelect={handleItemClick}
        />

        {items.length > 1 && (
          <CarouselChrome
            {...resolved}
            {...chromeVisibility(resolved, below)}
            counterText={counterText(copy, Boolean(resolved.showCounter), activeIndex + 1, items.length)}
            activeIndex={activeIndex}
            onPrev={handlePrev}
            onNext={handleNext}
            onSelect={handleSelect}
          />
        )}
      </Box>
    </CarouselBelow>
  );
};
