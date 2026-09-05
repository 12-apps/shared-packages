import type * as React from 'react';

import type { UiPaletteKey, UiTheme } from '../../../tokens/theme';

/**
 * THE LAYOUT PRIMITIVE BOTH RENDERERS SHARE.
 *
 * Half of every screen in the origin apps is `@12-apps/ui/mui/Box` with an `sx`
 * — raw MUI, which no native renderer can ever answer to. This `Box` is the
 * one a screen meant for both platforms writes instead: a fixed set of layout
 * props on the spacing scale, resolved by `box-layout.ts` into the same
 * numbers on each side. `p={2}` is 16px on the web and 16dp on native, because
 * both are `theme.spacing(2)`.
 *
 * Spacing props are in SPACING UNITS, exactly as MUI's own `Box` reads them.
 */
export type BoxDirection = 'row' | 'column' | 'row-reverse' | 'column-reverse';
export type BoxAlign = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type BoxJustify = 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';
export type BoxBackground = 'default' | 'paper' | 'transparent' | UiPaletteKey;
export type BoxRadius = keyof UiTheme['radius'];
/** What both renderers accept as a size: px, a percentage, or `auto`. */
export type BoxDimension = number | 'auto' | `${number}%`;

export interface BoxSpacingProps {
  p?: number;
  px?: number;
  py?: number;
  pt?: number;
  pr?: number;
  pb?: number;
  pl?: number;
  m?: number;
  mx?: number;
  my?: number;
  mt?: number;
  mr?: number;
  mb?: number;
  ml?: number;
  /** Between children. Setting it makes the box a flex container. */
  gap?: number;
}

export interface BoxBaseProps extends BoxSpacingProps {
  children?: React.ReactNode;
  /** Setting any of these four makes the box a flex container. */
  direction?: BoxDirection;
  align?: BoxAlign;
  justify?: BoxJustify;
  wrap?: boolean;
  flex?: number;
  /** A surface, `transparent`, or a palette slot's main colour. */
  bg?: BoxBackground;
  radius?: BoxRadius;
  /** A 1px border in the theme's divider colour. */
  bordered?: boolean;
  width?: BoxDimension;
  height?: BoxDimension;
  testID?: string;
  dataTestId?: string;
}

/** Every prop {@link BoxBaseProps} owns, so a renderer can split them from its own. */
export const BOX_BASE_KEYS = [
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'gap', 'direction', 'align', 'justify', 'wrap', 'flex',
  'bg', 'radius', 'bordered', 'width', 'height', 'testID', 'dataTestId',
] as const satisfies readonly (keyof Omit<BoxBaseProps, 'children'>)[];
