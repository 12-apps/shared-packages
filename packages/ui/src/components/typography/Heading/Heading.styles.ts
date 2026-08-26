import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type { HeadingProps } from './Heading.types';
import { HEADING_SCALE, headingMetrics, type HeadingLevel } from '../../../tokens/typography';
import type { ColorValue } from '../../../tokens/scales';

type Weight = NonNullable<HeadingProps['weight']>;

// Exhaustive over ColorValue, and deliberately without a fallback. The map
// happened to hold all seven already, but it was `Record<string, string>` with
// `|| text.primary` behind it — so nothing kept it that way, and the eighth
// colour would have rendered as ordinary body text with no complaint. That is
// the failure this whole vocabulary exists to make impossible; `Text` was
// tightened the same way and this one was missed.
const getColorFromTheme = (theme: Theme, color: ColorValue): string => {
  if (color === 'neutral') {
    return theme.palette.text.primary;
  }

  const colorMap: Record<Exclude<ColorValue, 'neutral'>, string> = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    info: theme.palette.info.main,
    danger: theme.palette.error.main,
  };

  return colorMap[color];
};

const WEIGHTS: Record<Weight, number> = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

/** The two-stop gradient each colour paints its glyphs with. */
const PRIMARY_STOPS = (theme: Theme): [string, string] => [
  theme.palette.primary.main,
  theme.palette.secondary.main,
];

// Keyed over the whole vocabulary, with no `?? PRIMARY_STOPS` behind it. Two
// stops were missing — `info` and `neutral` — so a gradient heading in either
// colour painted the PRIMARY gradient and looked deliberate while ignoring the
// prop entirely. The fallback is what hid it, so the fallback is gone.
const GRADIENT_STOPS: Record<ColorValue, (theme: Theme) => [string, string]> = {
  primary: PRIMARY_STOPS,
  secondary: (theme) => [theme.palette.secondary.main, theme.palette.primary.main],
  success: (theme) => [theme.palette.success.light, theme.palette.success.dark],
  warning: (theme) => [theme.palette.warning.light, theme.palette.warning.dark],
  info: (theme) => [theme.palette.info.light, theme.palette.info.dark],
  danger: (theme) => [theme.palette.error.light, theme.palette.error.dark],
  // The grey ramp has no light/dark pair, and every stop on it is
  // `string | undefined` under `noUncheckedIndexedAccess`.
  neutral: (theme) => [theme.palette.grey[500] ?? '#9e9e9e', theme.palette.grey[900] ?? '#212121'],
};

const gradientFor = (theme: Theme, color: ColorValue) => {
  const [from, to] = GRADIENT_STOPS[color](theme);
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
};

export interface HeadingFlags {
  /**
   * The step of the scale to DRAW. Named `customSize` rather than `customLevel`
   * because the rank is no longer what decides it — see `Heading.tsx`, which
   * resolves `size ?? level` before it gets here. This file no longer knows
   * which tag it is styling, and that is the point.
   */
  customSize?: string;
  customColor?: ColorValue;
  customWeight?: string;
  gradient?: boolean;
}

/** A step name the scale actually has, or `h2` — the documented default. */
const stepOf = (value: string | undefined): HeadingLevel =>
  value !== undefined && value in HEADING_SCALE ? (value as HeadingLevel) : 'h2';

export const headingSx = (theme: Theme, flags: HeadingFlags): CSSObject => {
  const { customSize, customColor = 'neutral', customWeight = 'bold', gradient } = flags;
  // From the THEME, with the package default underneath — never from a table in
  // this file. A host's `createTheme({ typography: { headingScale } })` is what
  // sets the house scale now; see `tokens/typography.ts` for why it is our own
  // key rather than MUI's `typography.h1`.
  const { normalWeight, ...metrics } = headingMetrics(theme, stepOf(customSize));

  const base: CSSObject = {
    fontFamily: theme.typography.h1.fontFamily,
    margin: 0,
    transition: 'all 0.2s ease',
    ...metrics,
    fontWeight:
      customWeight === 'normal' ? normalWeight : (WEIGHTS[customWeight as Weight] ?? WEIGHTS.bold),
  };

  if (!gradient) {
    return { ...base, color: getColorFromTheme(theme, customColor) };
  }

  // The gradient paints the glyphs themselves, so the text must draw no fill of
  // its own for it to show through.
  return {
    ...base,
    background: gradientFor(theme, customColor),
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    MozBackgroundClip: 'text',
    MozTextFillColor: 'transparent',
  };
};
