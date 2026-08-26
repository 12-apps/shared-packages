import { alpha } from '@mui/material/styles';
import type { CSSObject, Theme } from '@mui/material/styles';
import type React from 'react';

import { glowAnimation, pulseAnimation, shimmerAnimation } from './Sheet.animations';
import type { SheetProps } from './Sheet.types';
import { accentFor } from '../../../tokens/scales';

type Position = NonNullable<SheetProps['position']>;
type Variant = NonNullable<SheetProps['variant']>;
type Size = NonNullable<SheetProps['size']>;
type Color = NonNullable<SheetProps['color']>;

const isHorizontalPosition = (position: Position) => position === 'left' || position === 'right';

/**
 * Horizontal (left/right) sheets are viewport-aware: a px floor keeps the panel
 * usable, `…vw` lets the larger presets grow on wide screens (lg ≥32%, xl ≥40%
 * of the viewport), and the outer `min(92vw, …)` guarantees the panel never
 * overflows a small screen. Vertical presets stay fixed-height.
 */
const HORIZONTAL_SIZES: Record<Size, string> = {
  xs: 'min(92vw, 240px)',
  sm: 'min(92vw, 320px)',
  md: 'min(92vw, 400px)',
  lg: 'min(92vw, max(560px, 32vw))',
  xl: 'min(92vw, max(720px, 40vw))',
  full: '100%',
};

const VERTICAL_SIZES: Record<Size, number | string> = {
  xs: 200,
  sm: 300,
  md: 400,
  lg: 500,
  xl: 600,
  full: '100%',
};

interface SizeStyleInput {
  position: Position;
  size: Size;
  isDraggableVariant: boolean;
  isVerticalSheet: boolean;
  currentHeight: number | null;
}

const sizeStyles = ({
  position,
  size,
  isDraggableVariant,
  isVerticalSheet,
  currentHeight,
}: SizeStyleInput) => {
  // The draggable variant owns its own height: the snap point decides it, so a
  // preset would fight the drag.
  if (isDraggableVariant && isVerticalSheet && currentHeight !== null) {
    return { height: currentHeight };
  }

  return isHorizontalPosition(position)
    ? { width: HORIZONTAL_SIZES[size] ?? HORIZONTAL_SIZES.md }
    : { height: VERTICAL_SIZES[size] ?? VERTICAL_SIZES.md };
};

/** `r, g, b` for a hex colour, so it can feed an `rgba(var(--x), a)` custom property. */
const toRgbTriplet = (hexColor: string) => {
  const hex = hexColor.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
};

const roundedStyles = (theme: Theme, position: Position) => {
  const radius = theme.spacing(2);
  const byPosition: Record<Position, string> = {
    top: `0 0 ${radius} ${radius}`,
    bottom: `${radius} ${radius} 0 0`,
    left: `0 ${radius} ${radius} 0`,
    right: `${radius} 0 0 ${radius}`,
  };
  return { borderRadius: byPosition[position] };
};

interface VariantStyleInput {
  theme: Theme;
  variant: Variant;
  color: Color;
  position: Position;
  elevation: number;
  glow: boolean;
  pulse: boolean;
  glass: boolean;
  gradient: boolean;
  rounded: boolean;
  disabled: boolean;
  isDragging: boolean;
  isAnimating: boolean;
  isDraggableVariant: boolean;
  isVerticalSheet: boolean;
}

type SurfaceInput = VariantStyleInput & { accent: string };

/**
 * Each variant's own additions to the shared surface — never the shared part
 * itself. Every arm of the old switch re-spread the same base, glow, pulse and
 * rounded objects before adding these few rules; `variantStyles` applies that
 * prefix once and lets the table hold only what actually differs.
 */
const SURFACES: Record<Variant, (input: SurfaceInput) => Record<string, unknown>> = {
  draggable: ({ theme, elevation, accent }) => ({
    boxShadow: `
            ${theme.shadows[Math.min(elevation + 4, 24)]},
            0 -2px 10px 0 ${alpha(theme.palette.common.black, 0.1)}
          `,
    border: `1px solid ${alpha(theme.palette.divider, 0.12)}`,
    borderTop: `2px solid ${alpha(accent, 0.3)}`,
    transition: theme.transitions.create(['transform', 'box-shadow', 'border-color'], {
      duration: theme.transitions.duration.shorter,
      easing: theme.transitions.easing.easeInOut,
    }),
    '&:hover': { borderTopColor: alpha(accent, 0.5) },
  }),

  glass: ({ theme, glass }) => ({
    backgroundColor: alpha(theme.palette.background.paper, glass ? 0.75 : 0.95),
    backdropFilter: 'blur(24px) saturate(180%)',
    WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    border: `1px solid ${alpha(theme.palette.divider, 0.15)}`,
    boxShadow: `
            0 8px 32px 0 ${alpha(theme.palette.common.black, 0.15)},
            inset 0 0 0 1px ${alpha(theme.palette.common.white, 0.1)}
          `,
  }),

  gradient: ({ theme, color, gradient, accent }) => ({
    background: gradient
      ? `linear-gradient(
                135deg,
                ${theme.palette.background.paper} 0%,
                ${alpha(accent, 0.08)} 50%,
                ${alpha(accentFor(theme, color)?.dark || accent, 0.12)} 100%
              )`
      : theme.palette.background.paper,
    position: 'relative' as const,
    overflow: 'hidden' as const,
    '&::before': gradient ? shimmerOverlay(theme) : {},
  }),

  elevated: ({ theme, elevation }) => ({
    boxShadow: `
            ${theme.shadows[elevation]},
            0 20px 40px -15px ${alpha(theme.palette.common.black, 0.15)}
          `,
    transform: 'translateZ(0)',
    willChange: 'transform',
  }),

  minimal: () => ({ boxShadow: 'none', border: 'none' }),

  default: () => ({}),
};

/** The sweep of light the gradient variant runs across itself. */
const shimmerOverlay = (theme: Theme) => ({
  content: '""',
  position: 'absolute',
  top: 0,
  left: '-100%',
  width: '100%',
  height: '100%',
  background: `linear-gradient(
              90deg,
              transparent,
              ${alpha(theme.palette.common.white, 0.2)},
              transparent
            )`,
  animation: `${shimmerAnimation} 3s infinite`,
});

/**
 * The parts of the surface that do not depend on the variant: the paper colour,
 * the transition suppression while a drag or spring is driving the panel, the
 * disabled and cursor states, and the two colour custom properties the glow and
 * pulse keyframes read.
 */
const baseSurface = (input: VariantStyleInput, accent: string) => {
  const { theme, disabled, isDragging, isAnimating, isDraggableVariant, isVerticalSheet } = input;
  const colorRgb = toRgbTriplet(accent);

  return {
    backgroundColor: theme.palette.background.paper,
    // A transition would fight the per-frame height writes while a drag or a
    // snap animation is driving the panel.
    transition:
      !isDragging && !isAnimating
        ? theme.transitions.create(['all'], {
            duration: theme.transitions.duration.standard,
            easing: theme.transitions.easing.easeInOut,
          })
        : 'none',
    opacity: disabled ? 0.5 : 1,
    pointerEvents: disabled ? ('none' as const) : ('auto' as const),
    cursor: isDraggableVariant && isVerticalSheet ? 'grab' : 'auto',
    '--pulse-color': colorRgb,
    '--glow-color': colorRgb,
    ...(isDragging && { cursor: 'grabbing' }),
  };
};

const variantStyles = (input: VariantStyleInput) => {
  const { theme, variant, color, position, glow, pulse, rounded } = input;
  const accent = accentFor(theme, color)?.main || theme.palette.primary.main;

  return {
    ...baseSurface(input, accent),
    // glow first, then pulse: with both set the pulse keyframes win the shared
    // `animation` slot, which is the order the original spread produced.
    ...(glow && { animation: `${glowAnimation} 2s ease-in-out infinite`, filter: 'brightness(1.05)' }),
    ...(pulse && { animation: `${pulseAnimation} 2s infinite`, position: 'relative' as const }),
    ...(rounded && roundedStyles(theme, position)),
    ...(SURFACES[variant] ?? SURFACES.default)({ ...input, accent }),
  };
};

interface PanelSxInput extends VariantStyleInput {
  size: Size;
  currentHeight: number | null;
  fullHeight: boolean;
  style?: React.CSSProperties;
}

/**
 * The drawer paper's complete `sx`: its size, its variant surface, the caller's
 * own `style`, and the full-height rule.
 *
 * Built here rather than in the component so the component holds no style
 * branches of its own — the cross-axis rule below is four on its own.
 */
export const panelSx = (input: PanelSxInput): CSSObject => {
  const { position, size, isDraggableVariant, isVerticalSheet, currentHeight, fullHeight, style } =
    input;

  return {
    ...sizeStyles({ position, size, isDraggableVariant, isVerticalSheet, currentHeight }),
    ...variantStyles(input),
    ...style,
    overflow: 'visible',
    // Expand only the cross axis so the chosen `size` still governs the main
    // axis: side sheets keep their (responsive) width and go full-height;
    // top/bottom sheets keep their height and go full-width.
    ...(fullHeight &&
      !isDraggableVariant &&
      (isHorizontalPosition(position) ? { height: '100%' } : { width: '100%' })),
  };
};
