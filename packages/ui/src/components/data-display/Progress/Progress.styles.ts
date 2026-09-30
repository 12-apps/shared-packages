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
import { softNeutral } from '../../../tokens/ink';
import { rem, rems, sxRem } from '../../../tokens/relative';

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
    return softNeutral(theme);
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
// The lengths stay design px (`…Px`) and go through `rem` where they are drawn.
interface SizeStep {
  heightPx: number;
  circularSizePx: number;
  fontSize: (theme: Theme) => string;
}

const SIZE_MAP: Record<ProgressSize, SizeStep> = Object.fromEntries(
  Object.entries(PROGRESS_SIZES).map(([size, step]) => [
    size,
    { heightPx: step.height, circularSizePx: step.circularSize, fontSize: sxRem(step.fontSize) },
  ]),
) as Record<ProgressSize, SizeStep>;

export const getSizeStyles = (size?: ProgressSize) => SIZE_MAP[size as ProgressSize] || SIZE_MAP.md;

export const barVariantStyles = (
  theme: Theme,
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
        backdropFilter: `blur(${rem(theme, GLASS_BLUR_PX)})`,
        border: `1px solid ${alpha(colorPalette.main, GLASS_BAR_BORDER_ALPHA)}`,
      };
    default:
      return {};
  }
};

// glow and pulse are independent flags. The three combinations used to be spelled
// out one by one, but each is just the union of whichever flags are set.
export const barEmphasisStyles = (
  theme: Theme,
  colorPalette: PaletteColor,
  glow?: boolean,
  pulse?: boolean,
): CSSObject => ({
  ...(glow && {
    boxShadow: `${rems(theme, 0, 0, BAR_GLOW.blur, BAR_GLOW.spread)} ${alpha(colorPalette.main, BAR_GLOW.alpha)}`,
    filter: `brightness(${GLOW_BRIGHTNESS})`,
  }),
  ...(pulse && {
    animation: `${pulseAnimation} ${PULSE.durationMs / 1000}s infinite`,
  }),
});

export const circularEmphasisStyles = (
  theme: Theme,
  colorPalette: PaletteColor,
  glow?: boolean,
  pulse?: boolean,
): CSSObject => ({
  ...(glow && {
    filter: `drop-shadow(${rems(theme, 0, 0, CIRCULAR_GLOW.blur)} ${alpha(colorPalette.main, CIRCULAR_GLOW.alpha)})`,
  }),
  ...(pulse && {
    animation: `${pulseAnimation} ${PULSE.durationMs / 1000}s infinite`,
  }),
});
