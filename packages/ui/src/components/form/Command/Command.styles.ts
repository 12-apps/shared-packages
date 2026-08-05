import { alpha } from '@mui/material';
import type { CSSObject, Theme } from '@mui/material';

import type { CommandProps } from './Command.types';

type CommandVariant = NonNullable<CommandProps['variant']>;
type CommandColor = NonNullable<CommandProps['color']>;
type CommandSize = NonNullable<CommandProps['size']>;

const SIZE_MAP: Record<CommandSize, { width: number; fontSize: string }> = {
  xs: { width: 400, fontSize: '0.75rem' },
  sm: { width: 450, fontSize: '0.875rem' },
  md: { width: 500, fontSize: '1rem' },
  lg: { width: 550, fontSize: '1.125rem' },
  xl: { width: 600, fontSize: '1.25rem' },
};

export const commandSizeStyles = (size: CommandSize) => SIZE_MAP[size] || SIZE_MAP.md;

const emphasisStyles = (
  theme: Theme,
  color: CommandColor,
  glow: boolean,
  pulse: boolean,
): CSSObject => ({
  ...(glow && {
    boxShadow: `0 0 20px ${alpha(theme.palette[color].main, 0.4)}`,
  }),
  ...(pulse && {
    animation: 'pulse 2s infinite',
    '@keyframes pulse': {
      '0%': { boxShadow: `0 0 0 0 ${alpha(theme.palette[color].main, 0.4)}` },
      '70%': { boxShadow: `0 0 0 10px ${alpha(theme.palette[color].main, 0)}` },
      '100%': { boxShadow: `0 0 0 0 ${alpha(theme.palette[color].main, 0)}` },
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
        backdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette[color].main, 0.2)}`,
      };
    case 'gradient':
      return {
        background: `linear-gradient(135deg, ${theme.palette[color].main}, ${theme.palette[color].dark})`,
        color: theme.palette[color].contrastText,
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
