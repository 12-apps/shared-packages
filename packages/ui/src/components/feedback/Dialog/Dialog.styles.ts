import type { SxProps, Theme } from '@mui/material';
import { alpha, keyframes } from '@mui/material';

import type { DialogProps } from './Dialog.types';

/**
 * Paper/backdrop styling for the Dialog component (FUT-181 gate cleanup):
 * pure helpers so `Dialog.tsx` stays within the size/complexity budget.
 */

// Define pulse animation
const pulseAnimation = keyframes`
  0% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 1;
  }
  70% {
    box-shadow: 0 0 0 20px currentColor;
    opacity: 0;
  }
  100% {
    box-shadow: 0 0 0 0 currentColor;
    opacity: 0;
  }
`;

/** Style toggles that shape the dialog paper (extracted so each fn stays small). */
interface VariantStyleOptions {
  variant: NonNullable<DialogProps['variant']>;
  size: NonNullable<DialogProps['size']>;
  borderRadius: NonNullable<DialogProps['borderRadius']>;
  glass: boolean;
  gradient: boolean;
  glow: boolean;
  pulse: boolean;
}

function borderRadiusOf(theme: Theme, borderRadius: VariantStyleOptions['borderRadius']) {
  switch (borderRadius) {
    case 'none': return 0;
    case 'sm': return theme.spacing(0.5);
    case 'md': return theme.spacing(1);
    case 'xl': return theme.spacing(3);
    case 'lg':
    default: return theme.spacing(2);
  }
}

function maxWidthOf(size: VariantStyleOptions['size']): number {
  switch (size) {
    case 'xs': return 400;
    case 'sm': return 600;
    case 'lg': return 1000;
    case 'xl': return 1200;
    case 'md':
    default: return 800;
  }
}

function baseStylesOf(theme: Theme, opts: VariantStyleOptions) {
  return {
    borderRadius: borderRadiusOf(theme, opts.borderRadius),
    maxWidth: maxWidthOf(opts.size),
    width: '90vw',
    margin: theme.spacing(2),
    transition: theme.transitions.create(
      ['box-shadow', 'background-color', 'backdrop-filter'],
      { duration: theme.transitions.duration.standard },
    ),
  };
}

function glowStylesOf(theme: Theme, glow: boolean) {
  return glow ? { boxShadow: `0 0 40px ${alpha(theme.palette.primary.main, 0.3)}` } : {};
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
      opacity: 0.3,
      animation: `${pulseAnimation} 2s infinite`,
      pointerEvents: 'none' as const,
      zIndex: -1,
    },
  };
}

/** The default variant's paper: optional gradient/glass over the base styles. */
function defaultVariantStyles(theme: Theme, opts: VariantStyleOptions) {
  const gradientStyles = opts.gradient
    ? {
        background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)}, ${alpha(theme.palette.secondary.main, 0.1)})`,
        backdropFilter: 'blur(10px)',
      }
    : {};
  return {
    ...gradientStyles,
    backgroundColor: opts.glass
      ? alpha(theme.palette.background.paper, 0.1)
      : theme.palette.background.paper,
    backdropFilter: opts.glass ? 'blur(20px)' : 'none',
    border: opts.glass ? `1px solid ${alpha(theme.palette.primary.main, 0.2)}` : 'none',
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
        backgroundColor: alpha(theme.palette.background.paper, 0.1),
        backdropFilter: 'blur(20px)',
        border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
        boxShadow: `0 8px 32px ${alpha(theme.palette.common.black, 0.1)}`,
      };
    case 'fullscreen':
      return {
        borderRadius: 0,
        margin: 0,
        width: '100vw',
        height: '100vh',
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
        height: '100vh',
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
    backgroundColor: glass
      ? alpha(theme.palette.common.black, 0.2)
      : alpha(theme.palette.common.black, 0.5),
    backdropFilter: glass ? 'blur(8px)' : 'none',
  };
}

