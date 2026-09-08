import { alpha } from '@mui/material/styles/index.js';
import type { CSSObject, Theme } from '@mui/material/styles/index.js';
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
 * overflows a small screen.
 */
const HORIZONTAL_SIZES: Record<Size, string> = {
  xs: 'min(92vw, 240px)',
  sm: 'min(92vw, 320px)',
  md: 'min(92vw, 400px)',
  lg: 'min(92vw, max(560px, 32vw))',
  xl: 'min(92vw, max(720px, 40vw))',
  full: '100%',
};

/**
 * `size` governs a vertical sheet's MAIN axis, and it is a CEILING rather than
 * a height: the panel is as tall as what it holds, and starts scrolling only
 * once that would pass the preset.
 *
 * It was a fixed `height`, which meant a short sheet reserved the rest of the
 * preset as dead space — a `md` sheet holding three lines and a button drew a
 * 400px panel and floated them in it. `min(…, 100%)` keeps the ceiling under
 * the viewport, which is also what MUI's own bottom paper asks for.
 *
 * `full` is absent on purpose: it is not a ceiling, it is the whole viewport,
 * and `sizeStyles` answers it before it gets here.
 */
const VERTICAL_SIZES: Record<Exclude<Size, 'full'>, string> = {
  xs: 'min(200px, 100%)',
  sm: 'min(300px, 100%)',
  md: 'min(400px, 100%)',
  lg: 'min(500px, 100%)',
  xl: 'min(600px, 100%)',
};

/**
 * How wide a top/bottom sheet is allowed to get — its CROSS axis, so it is one
 * rule rather than one per `size` preset.
 *
 * A bottom sheet spanning the full width is a phone layout, and it was the only
 * layout this component had: on a desktop a panel holding a sentence and one
 * button was drawn 1900px wide, with the content stranded in the middle of it.
 * 640px is Material's own ceiling for a bottom sheet above the handset
 * breakpoint, and below it `100%` gives the phone back exactly what it had.
 *
 * `fullHeight` is the documented opt-out — it expands a vertical sheet along
 * this axis — and it becomes meaningful here for the first time: it used to
 * name the behaviour every bottom sheet already had.
 */
const VERTICAL_MAX_WIDTH = 'min(100%, 640px)';

interface SizeStyleInput {
  position: Position;
  size: Size;
  isDraggableVariant: boolean;
  currentHeight: number | null;
}

const sizeStyles = ({
  position,
  size,
  isDraggableVariant,
  currentHeight,
}: SizeStyleInput) => {
  if (isHorizontalPosition(position)) {
    return { width: HORIZONTAL_SIZES[size] ?? HORIZONTAL_SIZES.md };
  }

  // `full` is not a size on the scale — it is THE WHOLE VIEWPORT, on both axes,
  // and it has to stay that: a consumer using it for a phone takeover would
  // otherwise get a content-hugging 640px card out of a catalog bump, with
  // nothing in the API left to ask for what they had. So it is answered before
  // either rule below touches it.
  if (size === 'full') return { width: '100%', height: '100%' };

  // The cross axis is the same rule whatever the preset, and the draggable
  // variant needs it too — dragging moves the panel's height, never its width.
  // `marginInline` is what centres it: MUI pins the bottom paper `left: 0;
  // right: 0`, so a definite width plus auto margins resolves to the middle.
  const cross = { width: VERTICAL_MAX_WIDTH, marginInline: 'auto' };

  // The draggable variant owns its own height: the snap point decides it, so a
  // preset would fight the drag.
  if (isDraggableVariant && currentHeight !== null) {
    return { ...cross, height: currentHeight };
  }

  return {
    ...cross,
    // A CEILING, not a height — see `VERTICAL_SIZES`. `height: auto` is stated
    // rather than left off so the rule survives a caller who set a height on a
    // previous render, and it is what lets the panel hug what it holds.
    height: 'auto',
    maxHeight: VERTICAL_SIZES[size] ?? VERTICAL_SIZES.md,
  };
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
    // The DEFAULT, so the glow and the elevated shadow are not clipped by the
    // panel they hang off. It used to be stated last, which made it a rule
    // nothing could override — including `gradient`, whose own `overflow:
    // hidden` is what keeps its shimmer inside the panel. That was invisible
    // while every vertical sheet was full-bleed, because the sweep starts at
    // `left: -100%` and a full-width panel put it off-screen; a 640px one puts
    // it on the backdrop beside the sheet.
    overflow: 'visible',
    ...sizeStyles({ position, size, isDraggableVariant, currentHeight }),
    // A COLUMN, so `maxHeight` above can be a ceiling rather than a height: the
    // body is then a flex item that shrinks against it, and the scrolling falls
    // to `SheetContent` where it belongs. Without this the panel would clip a
    // long sheet instead of scrolling it.
    ...(isVerticalSheet ? { display: 'flex', flexDirection: 'column' } : {}),
    ...variantStyles(input),
    ...style,
    // Expand only the cross axis so the chosen `size` still governs the main
    // axis: side sheets keep their (responsive) width and go full-height;
    // top/bottom sheets keep their height and go full-width.
    ...(fullHeight &&
      !isDraggableVariant &&
      (isHorizontalPosition(position) ? { height: '100%' } : { width: '100%' })),
  };
};
