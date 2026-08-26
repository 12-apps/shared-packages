import type { PaletteColor, CSSObject, Theme } from '@mui/material/styles/index.js';
import { alpha, keyframes } from '@mui/material/styles/index.js';

import type { ProgressSize, ProgressVariant } from './Progress.types';

// Define pulse animation
export const pulseAnimation = keyframes`
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
  100% {
    opacity: 1;
  }
`;

export const getColorFromTheme = (theme: Theme, color: string): PaletteColor => {
  // Handle special case for neutral (grey) which is a Color, not PaletteColor
  if (color === 'neutral') {
    return {
      light: theme.palette.grey[300],
      main: theme.palette.grey[500],
      dark: theme.palette.grey[700],
      contrastText: theme.palette.getContrastText(theme.palette.grey[500]),
    };
  }

  const colorMap: Record<string, PaletteColor> = {
    primary: theme.palette.primary,
    secondary: theme.palette.secondary,
    success: theme.palette.success,
    warning: theme.palette.warning,
    error: theme.palette.error,
    info: theme.palette.info,
    danger: theme.palette.error, // Add danger alias
  };

  // Ensure we always return a valid color object with main and dark properties
  return colorMap[color] || theme.palette.primary;
};

const SIZE_MAP: Record<ProgressSize, { height: number; circularSize: number; fontSize: string }> = {
  xs: { height: 2, circularSize: 24, fontSize: '0.625rem' },
  sm: { height: 4, circularSize: 32, fontSize: '0.75rem' },
  md: { height: 6, circularSize: 40, fontSize: '0.875rem' },
  lg: { height: 8, circularSize: 48, fontSize: '1rem' },
  xl: { height: 10, circularSize: 56, fontSize: '1.125rem' },
};

export const getSizeStyles = (size?: ProgressSize) => SIZE_MAP[size as ProgressSize] || SIZE_MAP.md;

export const barVariantStyles = (
  variant: ProgressVariant | undefined,
  colorPalette: PaletteColor,
): CSSObject => {
  switch (variant) {
    case 'linear':
      return { backgroundColor: colorPalette.main };
    case 'gradient':
      return {
        background: `linear-gradient(90deg, ${colorPalette.main} 0%, ${colorPalette.dark || colorPalette.main} 100%)`,
      };
    case 'glass':
      return {
        backgroundColor: alpha(colorPalette.main, 0.8),
        backdropFilter: 'blur(10px)',
        border: `1px solid ${alpha(colorPalette.main, 0.3)}`,
      };
    default:
      return {};
  }
};

// glow and pulse are independent flags. The three combinations used to be spelled
// out one by one, but each is just the union of whichever flags are set.
export const barEmphasisStyles = (
  colorPalette: PaletteColor,
  glow?: boolean,
  pulse?: boolean,
): CSSObject => ({
  ...(glow && {
    boxShadow: `0 0 10px 2px ${alpha(colorPalette.main, 0.4)}`,
    filter: 'brightness(1.1)',
  }),
  ...(pulse && {
    animation: `${pulseAnimation} 2s infinite`,
  }),
});

export const circularEmphasisStyles = (
  colorPalette: PaletteColor,
  glow?: boolean,
  pulse?: boolean,
): CSSObject => ({
  ...(glow && {
    filter: `drop-shadow(0 0 8px ${alpha(colorPalette.main, 0.6)})`,
  }),
  ...(pulse && {
    animation: `${pulseAnimation} 2s infinite`,
  }),
});
