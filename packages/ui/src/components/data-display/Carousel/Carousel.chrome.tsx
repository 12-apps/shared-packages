import React from 'react';

import { CarouselCounter } from './Carousel.counter';
import { CarouselArrows, CarouselIndicators, CarouselThumbnails } from './Carousel.parts';
import type { CarouselCopy } from '../../../copy';
import { EN_US_CAROUSEL_COPY } from '../../../en-US.data-display';
import type {
  CarouselArrowsProps,
  CarouselIndicatorsProps,
  CarouselItem,
  CarouselThumbnailsProps,
} from './Carousel.types';

type IndicatorPosition = NonNullable<CarouselIndicatorsProps['position']>;
type Color = NonNullable<CarouselIndicatorsProps['color']>;

export interface CarouselChromeProps {
  /** The two arrows' accessible names, from the mount. */
  copy: CarouselCopy;
  items: CarouselItem[];
  activeIndex: number;
  loop: boolean;
  disabled: boolean;
  showArrows: boolean;
  showIndicators: boolean;
  showThumbnails: boolean;
  arrowPosition: NonNullable<CarouselArrowsProps['position']>;
  indicatorPosition: IndicatorPosition;
  color: Color;
  size: NonNullable<CarouselThumbnailsProps['size']>;
  indicatorVariant?: CarouselIndicatorsProps['variant'];
  showCounter?: boolean;
  counterPosition?: 'top-end' | 'bottom-end';
  hideArrowsOnTouch?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
}

/**
 * Everything drawn over the slides: the arrows, the indicators and the thumbnail
 * strip. Each is independently switchable, so they travel together rather than
 * as three conditional blocks inside the carousel's own render.
 */
export const CarouselChrome: React.FC<CarouselChromeProps> = ({
  copy,
  items,
  activeIndex,
  loop,
  disabled,
  showArrows,
  showIndicators,
  showThumbnails,
  arrowPosition,
  indicatorPosition,
  color,
  size,
  indicatorVariant,
  showCounter,
  counterPosition,
  hideArrowsOnTouch,
  onPrev,
  onNext,
  onSelect,
}) => {
  // One slide has nowhere to go: no arrows, dots, counter or strip to draw.
  if (items.length <= 1) return null;

  const position = copy.position ?? EN_US_CAROUSEL_COPY.position;

  return (
  <>
    {showArrows && !disabled && (
      <CarouselArrows
        copy={copy}
        onPrev={onPrev}
        onNext={onNext}
        position={arrowPosition}
        color={color}
        disablePrev={!loop && activeIndex === 0}
        disableNext={!loop && activeIndex === items.length - 1}
        hideOnTouch={hideArrowsOnTouch}
      />
    )}

    {showIndicators && indicatorPosition !== 'below' && (
      <CarouselIndicators
        copy={copy}
        count={items.length}
        activeIndex={activeIndex}
        onSelect={onSelect}
        position={indicatorPosition}
        color={color}
        variant={indicatorVariant}
      />
    )}

    {showCounter && (
      <CarouselCounter
        text={position(activeIndex + 1, items.length)}
        position={counterPosition}
      />
    )}

    {showThumbnails && (
      <CarouselThumbnails
        items={items}
        activeIndex={activeIndex}
        onSelect={onSelect}
        size={size}
      />
    )}
  </>
  );
};
