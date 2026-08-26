import type { BoxProps } from '@mui/material/Box/index.js';
import type { ReactNode, RefObject } from 'react';

export type ScrollOrientation = 'vertical' | 'horizontal' | 'both';
export type ScrollbarSize = 'thin' | 'medium' | 'thick';
export type ScrollAreaVariant = 'default' | 'overlay' | 'glass';

/**
 * Conditionally-required copy for the scroll-to-top control. The fab only exists
 * when `scrollToTopButton` is set, so only that side of the union owes a name —
 * a host that never shows the button is not asked for a word it cannot place.
 */
type ScrollAreaScrollToTop =
  | { scrollToTopButton?: false; scrollToTopLabel?: never }
  | { scrollToTopButton: true; scrollToTopLabel: string };

export type ScrollAreaProps = ScrollAreaBase & ScrollAreaScrollToTop;

export interface ScrollAreaBase extends Omit<BoxProps, 'ref'> {
  /**
   * The scroll region's accessible name. REQUIRED: the viewport is a
   * `role="region"`, so a screen reader announces this word and no other. The
   * package cannot know whether it wraps a menu, a chat log or a table.
   */
  regionLabel: string;

  /** Content to be rendered inside the scrollable area */
  children: ReactNode;

  /** External ref to attach to the scrollable element - useful for composing with VirtualList */
  scrollRef?: RefObject<HTMLDivElement | null>;

  /** Width of the scroll area container */
  width?: number | string;

  /** Height of the scroll area container */
  height?: number | string;

  /** Maximum height before scrolling is enabled */
  maxHeight?: number | string;

  /** Maximum width before scrolling is enabled */
  maxWidth?: number | string;

  /** Scroll orientation */
  orientation?: ScrollOrientation;

  /** Size of the scrollbar */
  scrollbarSize?: ScrollbarSize;

  /** Whether scrollbars auto-hide when not in use */
  autoHide?: boolean;

  /** Auto-hide delay in milliseconds */
  autoHideDelay?: number;

  /** Enable smooth scrolling behavior */
  smoothScroll?: boolean;

  /** Visual variant of the scroll area */
  variant?: ScrollAreaVariant;

  /** Scroll event handler */
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;

  /** Threshold for showing scroll-to-top button (in pixels) */
  scrollToTopThreshold?: number;

  /** Custom scrollbar color */
  scrollbarColor?: string;

  /** Custom scrollbar track color */
  scrollbarTrackColor?: string;

  /** Padding for scroll content */
  contentPadding?: number | string;

  /** Always show scrollbars */
  alwaysShowScrollbar?: boolean;

  /** Disable scrolling */
  disabled?: boolean;

  /** Loading state */
  loading?: boolean;

  /** Empty state content */
  emptyContent?: ReactNode;

  /** Test ID for testing */
  testId?: string;

  /** Callback when scroll area is resized - useful for responsive virtualization */
  onResize?: (dimensions: { width: number; height: number }) => void;
}
