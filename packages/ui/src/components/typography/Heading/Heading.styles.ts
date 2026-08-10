import type { CSSObject, Theme } from '@mui/material';

import type { HeadingProps } from './Heading.types';

type Level = NonNullable<HeadingProps['level']>;
type Weight = NonNullable<HeadingProps['weight']>;

const getColorFromTheme = (theme: Theme, color: string): string => {
  if (color === 'neutral') {
    return theme.palette.text.primary;
  }

  const colorMap: Record<string, string> = {
    primary: theme.palette.primary.main,
    secondary: theme.palette.secondary.main,
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    info: theme.palette.info.main,
    danger: theme.palette.error.main,
  };

  return colorMap[color] || theme.palette.text.primary;
};

const WEIGHTS: Record<Weight, number> = {
  light: 300,
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

/**
 * Each level's metrics, plus the weight it uses when the caller asks for
 * `normal`. A heading's "normal" is not body text's 400 — it is the weight that
 * level is meant to carry, which gets heavier as the level gets larger.
 */
const LEVELS: Record<Level, CSSObject & { normalWeight: number }> = {
  display: { fontSize: '4rem', lineHeight: 0.95, letterSpacing: '-0.03em', normalWeight: 800 },
  h1: { fontSize: '3rem', lineHeight: 1.1, letterSpacing: '-0.02em', normalWeight: 700 },
  h2: { fontSize: '2.5rem', lineHeight: 1.2, letterSpacing: '-0.015em', normalWeight: 700 },
  h3: { fontSize: '2rem', lineHeight: 1.25, letterSpacing: '-0.01em', normalWeight: 600 },
  h4: { fontSize: '1.5rem', lineHeight: 1.3, letterSpacing: '-0.005em', normalWeight: 600 },
  h5: { fontSize: '1.25rem', lineHeight: 1.4, normalWeight: 600 },
  h6: { fontSize: '1.125rem', lineHeight: 1.4, normalWeight: 600 },
};

/** The two-stop gradient each colour paints its glyphs with. */
const PRIMARY_STOPS = (theme: Theme): [string, string] => [
  theme.palette.primary.main,
  theme.palette.secondary.main,
];

const GRADIENT_STOPS: Record<string, (theme: Theme) => [string, string]> = {
  primary: PRIMARY_STOPS,
  secondary: (theme) => [theme.palette.secondary.main, theme.palette.primary.main],
  success: (theme) => [theme.palette.success.light, theme.palette.success.dark],
  warning: (theme) => [theme.palette.warning.light, theme.palette.warning.dark],
  danger: (theme) => [theme.palette.error.light, theme.palette.error.dark],
};

const gradientFor = (theme: Theme, color: string) => {
  const [from, to] = (GRADIENT_STOPS[color] ?? PRIMARY_STOPS)(theme);
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
};

export interface HeadingFlags {
  customLevel?: string;
  customColor?: string;
  customWeight?: string;
  gradient?: boolean;
}

export const headingSx = (theme: Theme, flags: HeadingFlags): CSSObject => {
  const { customLevel = 'h2', customColor = 'neutral', customWeight = 'bold', gradient } = flags;
  const { normalWeight, ...metrics } = LEVELS[customLevel as Level] ?? LEVELS.h2;

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
