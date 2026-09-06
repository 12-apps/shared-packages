import type { SxProps, Theme } from '@mui/material/styles/index.js';
import { alpha, keyframes } from '@mui/material/styles/index.js';

import type { DialogBorderRadius, DialogSize, DialogVariant } from './Dialog.base';
import {
  DIALOG_BACKDROP,
  DIALOG_BORDER_WIDTH,
  DIALOG_GLASS,
  DIALOG_GLOW,
  DIALOG_GRADIENT,
  DIALOG_MARGIN_UNITS,
  DIALOG_MAX_WIDTH,
  DIALOG_PULSE,
  DIALOG_RADIUS_UNITS,
  DIALOG_WIDTH_PERCENT,
} from './Dialog.metrics';
import { shadowCss } from '../../../tokens/shadow';
import { dynamicViewportHeight } from '../../../utils/viewport';

/**
 * Paper/backdrop styling for the Dialog component (FUT-181 gate cleanup):
 * pure helpers so `Dialog.tsx` stays within the size/complexity budget.
 *
 * Every number comes from `Dialog.metrics.ts`, which the native renderer reads
 * too — so a paper cannot be 800px wide on one side and 780 on the other.
 */

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 ${DIALOG_PULSE.spread}px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

/** Style toggles that shape the dialog paper (extracted so each fn stays small). */
interface VariantStyleOptions {
  variant: DialogVariant;
  size: DialogSize;
  borderRadius: DialogBorderRadius;
  glass: boolean;
  gradient: boolean;
  glow: boolean;
  pulse: boolean;
}

function borderRadiusOf(theme: Theme, borderRadius: VariantStyleOptions['borderRadius']) {
  const units = DIALOG_RADIUS_UNITS[borderRadius] ?? DIALOG_RADIUS_UNITS.lg;
  // `none` is a bare 0 rather than `spacing(0)`, as this has always written it.
  return units === 0 ? 0 : theme.spacing(units);
}

function maxWidthOf(size: VariantStyleOptions['size']): number {
  return DIALOG_MAX_WIDTH[size] ?? DIALOG_MAX_WIDTH.md;
}

function baseStylesOf(theme: Theme, opts: VariantStyleOptions) {
  return {
    borderRadius: borderRadiusOf(theme, opts.borderRadius),
    maxWidth: maxWidthOf(opts.size),
    width: `${DIALOG_WIDTH_PERCENT}vw`,
    margin: theme.spacing(DIALOG_MARGIN_UNITS),
    transition: theme.transitions.create(
      ['box-shadow', 'background-color', 'backdrop-filter'],
      { duration: theme.transitions.duration.standard },
    ),
  };
}

function glowStylesOf(theme: Theme, glow: boolean) {
  return glow
    ? {
        boxShadow: shadowCss({
          offsetX: 0,
          offsetY: 0,
          blurRadius: DIALOG_GLOW.blurRadius,
          spreadDistance: 0,
          color: alpha(theme.palette.primary.main, DIALOG_GLOW.alpha),
        }),
      }
    : {};
}

function pulseStylesOf(theme: Theme, pulse: boolean) {
  if (!pulse) return {};
  return {
    position: 'relative' as const,
    '&::after': {
      content: '""',
      position: 'absolute' as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 'inherit',
      backgroundColor: theme.palette.primary.main,
      opacity: DIALOG_PULSE.alpha,
      animation: `${pulseAnimation} ${DIALOG_PULSE.durationMs / 1000}s infinite`,
      pointerEvents: 'none' as const,
      zIndex: DIALOG_PULSE.zIndex,
    },
  };
}

/** The default variant's paper: optional gradient/glass over the base styles. */
function defaultVariantStyles(theme: Theme, opts: VariantStyleOptions) {
  const gradientStyles = opts.gradient
    ? {
        background: `linear-gradient(${DIALOG_GRADIENT.angleDeg}deg, ${alpha(theme.palette.primary.main, DIALOG_GRADIENT.stopAlpha)}, ${alpha(theme.palette.secondary.main, DIALOG_GRADIENT.stopAlpha)})`,
        backdropFilter: `blur(${DIALOG_GRADIENT.blurPx}px)`,
      }
    : {};
  return {
    ...gradientStyles,
    backgroundColor: opts.glass
      ? alpha(theme.palette.background.paper, DIALOG_GLASS.backgroundAlpha)
      : theme.palette.background.paper,
    backdropFilter: opts.glass ? `blur(${DIALOG_GLASS.blurPx}px)` : 'none',
    border: opts.glass
      ? `${DIALOG_BORDER_WIDTH}px solid ${alpha(theme.palette.primary.main, DIALOG_GLASS.borderAlpha)}`
      : 'none',
  };
}

export function variantStylesOf(theme: Theme, opts: VariantStyleOptions): SxProps<Theme> {
  const decorations = {
    ...glowStylesOf(theme, opts.glow),
    ...pulseStylesOf(theme, opts.pulse),
  };
  switch (opts.variant) {
    case 'glass':
      return {
        ...baseStylesOf(theme, opts),
        ...decorations,
        backgroundColor: alpha(theme.palette.background.paper, DIALOG_GLASS.backgroundAlpha),
        backdropFilter: `blur(${DIALOG_GLASS.blurPx}px)`,
        border: `${DIALOG_BORDER_WIDTH}px solid ${alpha(theme.palette.primary.main, DIALOG_GLASS.borderAlpha)}`,
        boxShadow: shadowCss({
          offsetX: 0,
          offsetY: DIALOG_GLASS.shadow.offsetY,
          blurRadius: DIALOG_GLASS.shadow.blurRadius,
          spreadDistance: 0,
          color: alpha(theme.palette.common.black, DIALOG_GLASS.shadow.alpha),
        }),
      };
    case 'fullscreen':
      return {
        borderRadius: 0,
        margin: 0,
        width: '100vw',
        // `100dvh`, not `100vh` — see `dynamicViewportHeight`.
        ...dynamicViewportHeight('height'),
        maxWidth: 'none',
        maxHeight: 'none',
        ...decorations,
      };
    case 'drawer': {
      const radius = borderRadiusOf(theme, opts.borderRadius);
      return {
        borderRadius: `${radius}px 0 0 ${radius}px`,
        margin: 0,
        width: maxWidthOf(opts.size),
        ...dynamicViewportHeight('height'),
        maxHeight: 'none',
        position: 'absolute' as const,
        right: 0,
        ...decorations,
      };
    }
    default:
      return {
        ...baseStylesOf(theme, opts),
        ...decorations,
        ...defaultVariantStyles(theme, opts),
      };
  }
}

export function backdropSxOf(theme: Theme, glass: boolean) {
  return {
    backgroundColor: alpha(
      theme.palette.common.black,
      glass ? DIALOG_BACKDROP.alpha.glass : DIALOG_BACKDROP.alpha.plain,
    ),
    backdropFilter: glass ? `blur(${DIALOG_BACKDROP.blurPx}px)` : 'none',
  };
}
