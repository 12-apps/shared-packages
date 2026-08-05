import type { Theme } from '@mui/material';

import type { ResizableProps, ResizableVariant, ResizeHandle } from './Resizable.types';

export interface Axis {
  min: number;
  max: number;
}

export interface Bounds {
  width: Axis;
  height: Axis;
}

export const defaultHandles = (variant: ResizableVariant): ResizeHandle[] => {
  switch (variant) {
    case 'horizontal':
      return ['right'];
    case 'vertical':
      return ['bottom'];
    default:
      return ['right', 'bottom', 'bottomRight'];
  }
};

const HORIZONTAL_GROW: readonly ResizeHandle[] = ['right', 'topRight', 'bottomRight'];
const HORIZONTAL_SHRINK: readonly ResizeHandle[] = ['left', 'topLeft', 'bottomLeft'];
const VERTICAL_GROW: readonly ResizeHandle[] = ['bottom', 'bottomLeft', 'bottomRight'];
const VERTICAL_SHRINK: readonly ResizeHandle[] = ['top', 'topLeft', 'topRight'];

const clamp = (value: number, { min, max }: Axis): number =>
  Math.max(min, Math.min(max, value));

/**
 * A handle on the right or bottom edge grows the box by the drag distance; one on
 * the left or top shrinks it by the same amount, because the opposite edge is
 * what stays put. A handle on neither edge of this axis leaves it alone.
 */
const alongAxis = (
  handle: ResizeHandle,
  grow: readonly ResizeHandle[],
  shrink: readonly ResizeHandle[],
  start: number,
  delta: number,
  bounds: Axis,
): number => {
  if (grow.includes(handle)) return clamp(start + delta, bounds);
  if (shrink.includes(handle)) return clamp(start - delta, bounds);
  return start;
};

export const resizedTo = (
  handle: ResizeHandle,
  delta: { x: number; y: number },
  start: { width: number; height: number },
  bounds: Bounds,
) => ({
  width: alongAxis(handle, HORIZONTAL_GROW, HORIZONTAL_SHRINK, start.width, delta.x, bounds.width),
  height: alongAxis(
    handle,
    VERTICAL_GROW,
    VERTICAL_SHRINK,
    start.height,
    delta.y,
    bounds.height,
  ),
});

export const handleStyle = (theme: Theme, handle: ResizeHandle, active: boolean) => {
  const baseStyle = {
    position: 'absolute' as const,
    backgroundColor: theme.palette.primary.main,
    opacity: 0,
    transition: theme.transitions.create('opacity'),
    '&:hover': {
      opacity: 0.3,
    },
    ...(active ? { opacity: 0.5 } : {}),
  };

  switch (handle) {
    case 'right':
      return { ...baseStyle, top: 0, right: -2, width: 4, height: '100%', cursor: 'ew-resize' };
    case 'bottom':
      return { ...baseStyle, bottom: -2, left: 0, width: '100%', height: 4, cursor: 'ns-resize' };
    case 'bottomRight':
      return {
        ...baseStyle,
        bottom: -2,
        right: -2,
        width: 8,
        height: 8,
        cursor: 'nw-resize',
        borderRadius: '50%',
      };
    default:
      return baseStyle;
  }
};

type ResizableDefaultedKeys =
  | 'variant'
  | 'width'
  | 'height'
  | 'minWidth'
  | 'maxWidth'
  | 'minHeight'
  | 'maxHeight'
  | 'disabled';

type ResolvedResizableProps = ResizableProps &
  Required<Pick<ResizableProps, ResizableDefaultedKeys>>;

const RESIZABLE_DEFAULTS: Pick<ResizableProps, ResizableDefaultedKeys> = {
  variant: 'both',
  width: 200,
  height: 200,
  minWidth: 50,
  maxWidth: 1000,
  minHeight: 50,
  maxHeight: 1000,
  disabled: false,
};

// Strips explicitly-undefined props before the merge, so `minWidth={undefined}`
// still falls back to the default exactly as a destructuring default would.
const definedProps = (props: ResizableProps): Partial<ResizableProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<ResizableProps>;

export const resolveResizableProps = (props: ResizableProps): ResolvedResizableProps =>
  ({ ...RESIZABLE_DEFAULTS, ...definedProps(props) }) as ResolvedResizableProps;
