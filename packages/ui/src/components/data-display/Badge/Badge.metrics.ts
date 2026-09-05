import type { BadgePosition, BadgeSize } from './Badge.base';
import { contrastText, type UiPaletteColor, type UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `Badge` RENDERERS DRAW WITH.
 *
 * `Badge.styles.ts` / `Badge.variants.ts` (web, emotion over MUI's `Badge`) and
 * `Badge.native.tsx` (React Native) read this one table: the five chips, the
 * dot inside them, the ten variants' alphas and borders, and the keyframes.
 * The web turns the px into rem and the padding into a shorthand; native uses
 * the numbers.
 */
export interface BadgeSizeMetrics {
  minWidth: number;
  height: number;
  /** The content's type size, in px. */
  fontSize: number;
  /** The chip's side padding, in px. `padding: '0 Npx'` on the web. */
  paddingHorizontal: number;
  dotSize: number;
  /** A leading icon's own type size, in px. */
  iconSize: number;
  /** The close glyph's type size, in px. `xl` falls back to `lg`, as the web does. */
  closeIconSize: number;
}

export const BADGE_SIZES: Record<BadgeSize, BadgeSizeMetrics> = {
  xs: { minWidth: 14, height: 14, fontSize: 8, paddingHorizontal: 3, dotSize: 6, iconSize: 10, closeIconSize: 8 },
  sm: { minWidth: 16, height: 16, fontSize: 10, paddingHorizontal: 4, dotSize: 8, iconSize: 12, closeIconSize: 10 },
  md: { minWidth: 20, height: 20, fontSize: 12, paddingHorizontal: 6, dotSize: 10, iconSize: 14, closeIconSize: 12 },
  lg: { minWidth: 24, height: 24, fontSize: 14, paddingHorizontal: 8, dotSize: 12, iconSize: 16, closeIconSize: 14 },
  xl: { minWidth: 28, height: 28, fontSize: 16, paddingHorizontal: 10, dotSize: 14, iconSize: 18, closeIconSize: 14 },
};

/** The chip's own type weight, its tracking, and the paper ring around it. */
export const BADGE_FONT_WEIGHT = 600;
export const BADGE_DESTRUCTIVE_FONT_WEIGHT = 700;
export const BADGE_LETTER_SPACING_EM = 0.025;
export const BADGE_BORDER_WIDTH = 2;
/** Between the icon, the content and the close button. */
export const BADGE_CONTENT_GAP = 2;

/* ── The ten variants' washes ─────────────────────────────────────────────── */

export const GLASS_BACKGROUND_ALPHA = 0.1;
export const GLASS_BORDER_ALPHA = 0.2;
export const GLASS_BLUR_PX = 10;
export const GLASS_SATURATE = 2;
export const GLASS_INSET_HIGHLIGHT_ALPHA = 0.1;
export const OUTLINE_BORDER_WIDTH = 2;
export const SECONDARY_BACKGROUND_ALPHA = 0.15;
export const SECONDARY_BORDER_ALPHA = 0.3;

/* ── Emphasis and animation ───────────────────────────────────────────────── */

/** `glow` without `pulse`: a 15px halo, brighter under the pointer. */
export const GLOW = { blur: 15, spread: 3, alpha: 0.5, hoverBlur: 20, hoverSpread: 4, hoverAlpha: 0.6, brightness: 1.1 } as const;
/** `glow` WITH `pulse`: the halo breathes between these two. */
export const GLOW_PULSE = { fromBlur: 5, fromSpread: 2, fromAlpha: 0.4, toBlur: 20, toSpread: 4, toAlpha: 0.8 } as const;
/** MUI-free `pulseAnimation`: 1 → 1.2 → 1 while the opacity dips to 0.7. */
export const PULSE = { durationMs: 2000, scale: 1.2, opacity: 0.7 } as const;
/** `bounceAnimation`: up 8px at 40%, 4px at 60%, over one second. */
export const BOUNCE = { durationMs: 1000, lift: 8, secondLift: 4, scale: 1.05, secondScale: 1.02 } as const;
/** `fadeInScaleAnimation`: in from half size, overshooting to 1.1. */
export const FADE_IN_SCALE = { durationMs: 400, from: 0.5, overshoot: 1.1 } as const;
/** The shimmer sweep, and the white it is made of. */
export const SHIMMER = { durationMs: 3000, alpha: 0.4 } as const;
/** How long the mount animation is held before the flag clears. */
export const MOUNT_ANIMATION_MS = 1000;
/** MUI's `Zoom` on close, and the wait before the caller is told. */
export const CLOSE_DELAY_MS = 300;
/** `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)` on the chip. */
export const BADGE_TRANSITION_MS = 300;
export const BADGE_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** The chip grows a tenth under the pointer. */
export const HOVER_SCALE = 1.1;

/* ── Placement ────────────────────────────────────────────────────────────── */

export interface BadgeAnchor {
  vertical: 'top' | 'bottom';
  horizontal: 'left' | 'right';
}

export const badgeAnchor = (position: BadgePosition): BadgeAnchor => {
  const [vertical, horizontal] = position.split('-') as ['top' | 'bottom', 'left' | 'right'];
  return { vertical, horizontal };
};

/**
 * `neutral` has no palette slot of its own in MUI, so `Badge.styles.ts` draws
 * it from three greys; `danger` is MUI's `error`, which is what the shared
 * theme calls `danger`. Same colours here.
 */
export function badgePalette(theme: UiTheme, color: ColorValue): UiPaletteColor {
  if (color === 'neutral') {
    return {
      main: theme.palette.grey[600],
      light: theme.palette.grey[400],
      dark: theme.palette.grey[800],
      contrastText: contrastText(theme.palette.grey[600]),
    };
  }
  return theme.palette[color];
}
