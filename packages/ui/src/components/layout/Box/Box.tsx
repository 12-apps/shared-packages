import MuiBox from '@mui/material/Box/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import * as React from 'react';

import { resolveBoxLayout, splitBoxProps, type BoxLayout } from './box-layout';
import type { BoxProps } from './Box.types';
import { resolveTestId } from '../../../platform/test-id';
import { useUiTheme } from '../../../provider/use-ui-theme';

/**
 * `sx` is not CSS: it reads a bare number on `padding`, `margin` or `gap` as
 * SPACING UNITS, on `borderRadius` as a multiple of `shape.borderRadius`, and a
 * `width` of `1` or less as a fraction. The resolver's numbers are already px,
 * so every one of them is written as a px string — otherwise a `p={2}` box
 * renders 128px of padding on the web and 16dp on native, which is the one
 * thing this component exists to rule out.
 */
const PX_KEYS = new Set<keyof BoxLayout>([
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'borderRadius', 'borderWidth', 'width', 'height',
]);

export function layoutToSx(layout: BoxLayout): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(layout).map(([key, value]) => [
      key,
      typeof value === 'number' && PX_KEYS.has(key as keyof BoxLayout) ? `${value}px` : value,
    ]),
  );
}

/**
 * The web `Box`: MUI's, with the neutral layout props resolved into `sx` ahead
 * of whatever `sx` the caller adds — so the caller's escape hatch still wins.
 */
export const Box = React.forwardRef<HTMLDivElement, BoxProps>(
  ({ children, sx, ...props }, ref) => {
    const theme = useUiTheme();
    const { layout, rest } = splitBoxProps(props);
    const resolved = layoutToSx(resolveBoxLayout(layout, theme)) as SxProps<Theme>;
    const testId = resolveTestId(layout);
    const merged: SxProps<Theme> = [
      resolved,
      ...(Array.isArray(sx) ? sx : sx === undefined ? [] : [sx]),
    ] as SxProps<Theme>;

    return (
      <MuiBox ref={ref} sx={merged} data-testid={testId} {...rest}>
        {children}
      </MuiBox>
    );
  },
);

Box.displayName = 'Box';
