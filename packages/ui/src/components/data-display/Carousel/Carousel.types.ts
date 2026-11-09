import type { ColorValue, SizeValue } from '../../../tokens/scales';
import type { CSSProperties, ReactNode } from 'react';
import type { CarouselCopy } from '../../../copy';

export interface CarouselItem {
  id: string;
  content: ReactNode;
  title?: string;
  description?: string;
  image?: string;
  alt?: string;
}

export interface CarouselProps {
  /**
   * The arrows' accessible names (a glyph and nothing else, so this IS what a
   * screen reader announces), plus the optional region, slide and counter
   * wording. REQUIRED.
   */
  copy: CarouselCopy;
  items: CarouselItem[];
  variant?: 'default' | 'glass' | 'gradient' | 'elevated' | 'minimal' | 'cards';
  size?: SizeValue;
  color?: ColorValue;
  autoPlay?: boolean;
  autoPlayInterval?: number;
  loop?: boolean;
  showIndicators?: boolean;
  showArrows?: boolean;
  showThumbnails?: boolean;
  fade?: boolean;
  glow?: boolean;
  pulse?: boolean;
  glass?: boolean;
  gradient?: boolean;
  ripple?: boolean;
  loading?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  height?: number | string;
  width?: number | string;
  spacing?: number;
  slidesPerView?: number;
  centerMode?: boolean;
  pauseOnHover?: boolean;
  onClick?: (item: CarouselItem, index: number) => void;
  onChange?: (index: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  indicatorPosition?: 'top' | 'bottom' | 'left' | 'right';
  arrowPosition?: 'inside' | 'outside' | 'overlay';
  animation?: 'slide' | 'fade' | 'zoom' | 'flip';
  /** The slide shown first (0-based, clamped). Read once, on mount. */
  startIndex?: number;
  /**
   * Draws an "n of m" chip on the photo, worded by `copy.position`. Stays in
   * step with the indicators. Hidden with a single item.
   */
  showCounter?: boolean;
  counterPosition?: 'top-end' | 'bottom-end';
  /** How the indicators look; `pills` is small dots with a wider current one. */
  indicatorVariant?: NonNullable<CarouselIndicatorsProps['variant']>;
  /** Hides the arrows on a touch-only device, where a swipe does their job. */
  hideArrowsOnTouch?: boolean;
}

export interface CarouselIndicatorsProps {
  count: number;
  activeIndex: number;
  onSelect: (index: number) => void;
  position?: 'top' | 'bottom' | 'left' | 'right';
  color?: ColorValue;
  variant?: 'dots' | 'lines' | 'numbers' | 'pills';
  /** Names each indicator through `goToSlide`; the English pack's wording when omitted. */
  copy?: CarouselCopy;
  className?: string;
  style?: CSSProperties;
}

export interface CarouselArrowsProps {
  copy: CarouselCopy;
  onPrev: () => void;
  onNext: () => void;
  position?: 'inside' | 'outside' | 'overlay';
  disabled?: boolean;
  disablePrev?: boolean;
  disableNext?: boolean;
  /** Hidden on a touch-only device, where a swipe does their job. */
  hideOnTouch?: boolean;
  color?: ColorValue;
  size?: SizeValue;
  className?: string;
  style?: CSSProperties;
}

export interface CarouselThumbnailsProps {
  items: CarouselItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
  size?: SizeValue;
  className?: string;
  style?: CSSProperties;
}
