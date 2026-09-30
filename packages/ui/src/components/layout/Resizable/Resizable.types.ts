import type { ReactNode } from 'react';

export type ResizableVariant = 'horizontal' | 'vertical' | 'both';
export type ResizeHandle =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'topRight'
  | 'bottomRight'
  | 'bottomLeft'
  | 'topLeft';

export interface ResizableProps {
  children: ReactNode;
  variant?: ResizableVariant;
  /** Starting width (default 200). Design px, scaled with the theme's type scale. */
  width?: number;
  /** Starting height (default 200). Design px, scaled with the theme's type scale. */
  height?: number;
  /** Narrowest a drag can make it (default 50). Design px, scaled with the theme's type scale. */
  minWidth?: number;
  /** Widest a drag can make it (default 1000). Design px, scaled with the theme's type scale. */
  maxWidth?: number;
  /** Shortest a drag can make it (default 50). Design px, scaled with the theme's type scale. */
  minHeight?: number;
  /** Tallest a drag can make it (default 1000). Design px, scaled with the theme's type scale. */
  maxHeight?: number;
  /**
   * Fired on every drag step with the new size, in design px — the unit `width`
   * and `height` take, so feeding it back keeps a controlled box where it is.
   */
  onResize?: (width: number, height: number) => void;
  disabled?: boolean;
  handles?: ResizeHandle[];
  className?: string;
  /**
   * The data-testid attribute for the resizable container.
   * Also generates testIds for child elements:
   * - `{dataTestId}-container` - Main resizable container
   * - `{dataTestId}-handle-{handlePosition}` - Individual resize handles (e.g., "resizable-handle-right")
   */
  'data-testid'?: string;
}
