import type { CSSProperties, ReactNode, RefObject } from 'react';

export type VirtualListVariant = 'fixed' | 'variable' | 'grid';

export interface VirtualListItem {
  id: string | number;
  /** This item's own height, for a `variable` list — design px, scaled with the theme's type scale. */
  height?: number;
  data?: unknown;
}

export interface VirtualListProps {
  items: VirtualListItem[];
  variant?: VirtualListVariant;
  /** The viewport's height — design px, scaled with the theme's type scale. */
  height: number;
  /**
   * The viewport's width. A number of 1 or less is a fraction of the parent (as
   * in `sx`); a larger number is design px, scaled with the theme's type scale; a string is used as given.
   */
  width?: number | string;
  /** Every row's height in a `fixed` list (default 40) — design px, scaled with the theme's type scale. */
  itemHeight?: number;
  /** The height assumed for a `variable` item that declares none (default 40) — design px, scaled with the theme's type scale. */
  estimatedItemHeight?: number;
  overscan?: number; // Number of items to render outside visible area
  renderItem: (params: { item: VirtualListItem; index: number; style: CSSProperties }) => ReactNode;
  onScroll?: (scrollTop: number) => void;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
  'aria-label'?: string;
  /** External scroll container ref - when provided, uses this element for scroll events */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  /** Disable internal scroll container - use when composing with external ScrollArea */
  disableInternalScroll?: boolean;
}

export interface VirtualGridProps {
  items: VirtualListItem[];
  /** The viewport's height — design px, scaled with the theme's type scale. */
  height: number;
  /**
   * The viewport's width. A number of 1 or less is a fraction of the parent (as
   * in `sx`); a larger number is design px, scaled with the theme's type scale, and also what an unset
   * `columnWidth` is shared out of; a string is used as given.
   */
  width?: number | string;
  columnCount: number;
  /** Every row's height — design px, scaled with the theme's type scale. */
  rowHeight: number;
  /** Every column's width — design px, scaled with the theme's type scale. */
  columnWidth?: number;
  /** The space between two rows and between two columns — design px, scaled with the theme's type scale. */
  gap?: number;
  overscan?: number;
  renderItem: (params: {
    item: VirtualListItem;
    index: number;
    columnIndex: number;
    rowIndex: number;
    style: CSSProperties;
  }) => ReactNode;
  onScroll?: (scrollTop: number, scrollLeft: number) => void;
  className?: string;
  style?: CSSProperties;
  'data-testid'?: string;
  'aria-label'?: string;
  /** External scroll container ref - when provided, uses this element for scroll events */
  scrollContainerRef?: RefObject<HTMLElement | null>;
  /** Disable internal scroll container - use when composing with external ScrollArea */
  disableInternalScroll?: boolean;
}
