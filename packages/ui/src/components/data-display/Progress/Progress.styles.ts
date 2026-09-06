import type { PaletteColor, CSSObject, Theme } from '@mui/material/styles/index.js';
import { alpha, keyframes } from '@mui/material/styles/index.js';

import {
  BAR_GLOW,
  CIRCULAR_GLOW,
  GLASS_BAR_ALPHA,
  GLASS_BAR_BORDER_ALPHA,
  GLASS_BLUR_PX,
  GLOW_BRIGHTNESS,
  PROGRESS_SIZES,
  PULSE,
} from './Progress.metrics';
import type { ProgressSize, ProgressVariant } from './Progress.types';
import { px } from '../../../tokens/theme';

// Define pulse animation. The stops and the two seconds are the shared metrics'
// (`PULSE`), so the native `Progress` breathes on the same cadence.
export const pulseAnimation = keyframes`
  0% {
    opacity: 1;
  }
  50% {
    opacity: ${PULSE.dip};
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

// Derived from the shared metrics, not restated: the native `Progress` reads
// the same table, so the two renderers cannot disagree on a size.
const SIZE_MAP: Record<ProgressSize, { height: number; circularSize: number; fontSize: string }> =
  Object.fromEntries(
    Object.entries(PROGRESS_SIZES).map(([size, step]) => [
      size,
      { height: step.height, circularSize: step.circularSize, fontSize: px(step.fontSize) },
    ]),
  ) as Record<ProgressSize, { height: number; circularSize: number; fontSize: string }>;

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
        backgroundColor: alpha(colorPalette.main, GLASS_BAR_ALPHA),
        backdropFilter: `blur(${GLASS_BLUR_PX}px)`,
        border: `1px solid ${alpha(colorPalette.main, GLASS_BAR_BORDER_ALPHA)}`,
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
    boxShadow: `0 0 ${BAR_GLOW.blur}px ${BAR_GLOW.spread}px ${alpha(colorPalette.main, BAR_GLOW.alpha)}`,
    filter: `brightness(${GLOW_BRIGHTNESS})`,
  }),
  ...(pulse && {
    animation: `${pulseAnimation} ${PULSE.durationMs / 1000}s infinite`,
  }),
});

export const circularEmphasisStyles = (
  colorPalette: PaletteColor,
  glow?: boolean,
  pulse?: boolean,
): CSSObject => ({
  ...(glow && {
    filter: `drop-shadow(0 0 ${CIRCULAR_GLOW.blur}px ${alpha(colorPalette.main, CIRCULAR_GLOW.alpha)})`,
  }),
  ...(pulse && {
    animation: `${pulseAnimation} ${PULSE.durationMs / 1000}s infinite`,
  }),
});
