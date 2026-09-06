import type { AvatarSize, AvatarStatus } from './Avatar.base';
import type { UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `Avatar` RENDERERS DRAW WITH.
 *
 * `Avatar.view.tsx` (web, emotion over MUI's `Avatar` and `Badge`) and
 * `Avatar.native.tsx` (React Native) read this one table: the six boxes and
 * their type, the status dot, the glow, the shimmer and the spinner. The web
 * turns the px into rem; native uses the numbers.
 */
export interface AvatarSizeMetrics {
  /** The square the portrait fills, in px. */
  box: number;
  /** The initials' type size, in px. */
  fontSize: number;
}

export const AVATAR_SIZES: Record<AvatarSize, AvatarSizeMetrics> = {
  xs: { box: 24, fontSize: 12 },
  sm: { box: 32, fontSize: 14 },
  md: { box: 40, fontSize: 16 },
  lg: { box: 48, fontSize: 18 },
  xl: { box: 64, fontSize: 24 },
  xxl: { box: 80, fontSize: 32 },
};

/** `rounded` takes one spacing unit; `circle` and `status` are round. */
export const ROUNDED_RADIUS_UNITS = 1;

/** The paper ring an avatar takes inside a group, and the hairline outside it. */
export const BORDER_WIDTH = 2;
export const BORDER_HALO_ALPHA = 0.2;

/** `glow`: a 20px halo at five pixels of spread, and a brightness lift. */
export const GLOW = { blur: 20, spread: 5, alpha: 0.4, brightness: 1.05 } as const;

/** `pulse`: the `::after` ring, from nothing to 10px while it fades out. */
export const PULSE = { durationMs: 2000, alpha: 0.3, spread: 10 } as const;

/** The shimmer that runs across a loading avatar. */
export const SHIMMER = { durationMs: 1500, fromAlpha: 0.6, toAlpha: 0.8 } as const;

/** The overlay over a loading avatar, and the ring spinning in it. */
export const LOADING_OVERLAY = { paperAlpha: 0.7, blur: 2 } as const;
export const SPINNER = {
  /** A share of the avatar's box. */
  scale: 0.4,
  ringWidth: 2,
  trackAlpha: 0.3,
  durationMs: 800,
} as const;

/**
 * The status dot: a fifth of the box, never below 8px, inside a paper ring.
 * `anchor` is MUI's `overlap="circular"` inset — the dot's CENTRE sits 14% of
 * the box in from the bottom-right corner.
 */
export const STATUS_DOT = { scale: 0.2, min: 8, borderWidth: 2, anchor: 0.14 } as const;

/**
 * The default and broken-image glyphs are ordinary `SvgIcon`s here, not MUI's
 * own `.MuiAvatar-fallback` (which is 75% of the box): this component passes
 * them as CHILDREN, so they render at the icon default whatever the box is.
 */
export const GLYPH_SIZE = 24;

/** MUI's `Fade` timeout on mount, and the scale-in behind it. */
export const FADE_MS = 300;
export const SCALE_IN_MS = 300;

/** `transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`. */
export const AVATAR_TRANSITION_MS = 300;
export const AVATAR_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** The interactive lift, which is a `:hover` on the web. */
export const HOVER = { scale: 1.1, lift: 2, shadowY: 8, shadowBlur: 20, shadowAlpha: 0.3, brightness: 1.1 } as const;
export const ACTIVE_SCALE = 1.05;

/** The focus ring `:focus-visible` draws. */
export const FOCUS_RING = { width: 3, offset: 2, alpha: 0.5 } as const;

/** An avatar group's default overlap, in px, and its hover lift. */
export const GROUP_OVERLAP = 8;
export const GROUP_MAX = 4;
export const GROUP_HOVER = { scale: 1.1, lift: 4 } as const;

/** The dot's colour per status. `offline` is the ramp, the rest are semantic. */
export function statusColor(theme: UiTheme, status: AvatarStatus): string {
  if (status === 'online') return theme.palette.success.main;
  if (status === 'away') return theme.palette.warning.main;
  if (status === 'busy') return theme.palette.danger.main;
  return theme.palette.grey[500];
}

export interface AvatarAccent {
  main: string;
  contrastText: string;
}

/**
 * The accent behind the initials. `danger`, NOT `error` — the web map was keyed
 * on MUI's word while the prop took the house one, so `danger` matched nothing
 * and fell through to primary: a red avatar rendering blue, silently.
 */
export function avatarAccent(theme: UiTheme, color: ColorValue): AvatarAccent {
  if (color === 'neutral') return { main: theme.palette.grey[700], contrastText: '#fff' };
  const accent = theme.palette[color];
  return { main: accent.main, contrastText: accent.contrastText || '#fff' };
}
