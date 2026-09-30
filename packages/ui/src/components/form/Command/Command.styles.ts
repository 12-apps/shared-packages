import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';

import type { CommandProps } from './Command.types';
import { accentFor, rem } from '../../../tokens/scales';

type CommandVariant = NonNullable<CommandProps['variant']>;
type CommandColor = NonNullable<CommandProps['color']>;
type CommandSize = NonNullable<CommandProps['size']>;

const SIZE_MAP: Record<CommandSize, { widthPx: number; fontPx: number }> = {
  xs: { widthPx: 400, fontPx: 12 },
  sm: { widthPx: 450, fontPx: 14 },
  md: { widthPx: 500, fontPx: 16 },
  lg: { widthPx: 550, fontPx: 18 },
  xl: { widthPx: 600, fontPx: 20 },
};

/** The paper's width and type for a size, both design px read through the type scale. */
export const commandSizeStyles = (theme: Theme, size: CommandSize) => {
  const { widthPx, fontPx } = SIZE_MAP[size] || SIZE_MAP.md;
  return { width: rem(theme, widthPx), fontSize: rem(theme, fontPx) };
};

const emphasisStyles = (
  theme: Theme,
  color: CommandColor,
  glow: boolean,
  pulse: boolean,
): CSSObject => ({
  ...(glow && {
    boxShadow: `0 0 ${rem(theme, 20)} ${alpha(accentFor(theme, color).main, 0.4)}`,
  }),
  ...(pulse && {
    animation: 'pulse 2s infinite',
    '@keyframes pulse': {
      '0%': { boxShadow: `0 0 0 0 ${alpha(accentFor(theme, color).main, 0.4)}` },
      '70%': { boxShadow: `0 0 0 ${rem(theme, 10)} ${alpha(accentFor(theme, color).main, 0)}` },
      '100%': { boxShadow: `0 0 0 0 ${alpha(accentFor(theme, color).main, 0)}` },
    },
  }),
});

const surfaceStyles = (
  theme: Theme,
  variant: CommandVariant,
  color: CommandColor,
): CSSObject => {
  switch (variant) {
    case 'glass':
      return {
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: `blur(${rem(theme, 20)})`,
        border: `1px solid ${alpha(accentFor(theme, color).main, 0.2)}`,
      };
    case 'gradient':
      return {
        background: `linear-gradient(135deg, ${accentFor(theme, color).main}, ${accentFor(theme, color).dark})`,
        color: accentFor(theme, color).contrastText,
      };
    case 'elevated':
      return { boxShadow: theme.shadows[8] };
    case 'minimal':
      return { border: 'none', boxShadow: 'none' };
    default:
      return {};
  }
};

/**
 * Every variant shares the same transition and the same optional glow/pulse; only
 * the surface — background, border, shadow — differs.
 */
export const commandPaperStyles = (
  theme: Theme,
  { variant, color, glow, pulse }: {
    variant: CommandVariant;
    color: CommandColor;
    glow: boolean;
    pulse: boolean;
  },
): CSSObject => ({
  transition: theme.transitions.create(['all'], {
    duration: theme.transitions.duration.standard,
  }),
  ...emphasisStyles(theme, color, glow, pulse),
  ...surfaceStyles(theme, variant, color),
});
