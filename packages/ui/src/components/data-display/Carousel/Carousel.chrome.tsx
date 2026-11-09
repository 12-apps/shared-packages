import React from 'react';

import { CarouselCounter } from './Carousel.counter';
import { CarouselArrows, CarouselIndicators, CarouselThumbnails } from './Carousel.parts';
import type { CarouselCopy } from '../../../copy';
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
  showArrows: boolean;
  showIndicators: boolean;
  showThumbnails: boolean;
  arrowPosition: NonNullable<CarouselArrowsProps['position']>;
  indicatorPosition: IndicatorPosition;
  color: Color;
  size: NonNullable<CarouselThumbnailsProps['size']>;
  indicatorVariant?: CarouselIndicatorsProps['variant'];
  /** The counter's text, already worded; no counter when absent. */
  counterText?: string;
  counterPosition?: 'top-end' | 'bottom-end';
  hideArrowsOnTouch?: boolean;
  arrowVariant?: CarouselArrowsProps['variant'];
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
  showArrows,
  showIndicators,
  showThumbnails,
  arrowPosition,
  indicatorPosition,
  color,
  size,
  indicatorVariant,
  counterText,
  counterPosition,
  hideArrowsOnTouch,
  arrowVariant,
  onPrev,
  onNext,
  onSelect,
}) => {
  return (
  <>
    {showArrows && (
      <CarouselArrows
        copy={copy}
        onPrev={onPrev}
        onNext={onNext}
        position={arrowPosition}
        color={color}
        disablePrev={!loop && activeIndex === 0}
        disableNext={!loop && activeIndex === items.length - 1}
        hideOnTouch={hideArrowsOnTouch}
        variant={arrowVariant}
      />
    )}

    {showIndicators && (
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

    {counterText && (
      <CarouselCounter
        text={counterText}
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
