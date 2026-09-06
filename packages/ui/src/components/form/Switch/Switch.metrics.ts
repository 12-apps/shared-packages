import type { SwitchVariant } from './Switch.base';
import { alpha } from '../../../tokens/color';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `Switch` RENDERERS DRAW WITH.
 *
 * `Switch.styles.ts` (web, emotion over MUI's `Switch`) and
 * `Switch.native.tsx` (React Native, drawing the track and thumb itself) read
 * this one table: the geometry per size, the four looks' radii and shadows,
 * the resting track colours, and the type the label, the description and the
 * helper are set in.
 *
 * Spacing is in SPACING UNITS where the web writes `theme.spacing(n)`;
 * everything else is px, a ratio or an alpha.
 */

/** MUI's `palette.common.black`, which `UiTheme` does not carry. */
export const SWITCH_BLACK = '#000';

export interface SwitchGeometry {
  width: number;
  height: number;
  padding: number;
  thumbSize: number;
}

export const SWITCH_SIZES: Record<SizeValue, SwitchGeometry> = {
  xs: { width: 34, height: 18, padding: 1, thumbSize: 14 },
  sm: { width: 42, height: 22, padding: 1, thumbSize: 18 },
  md: { width: 50, height: 26, padding: 1, thumbSize: 22 },
  lg: { width: 58, height: 30, padding: 2, thumbSize: 24 },
  xl: { width: 66, height: 34, padding: 2, thumbSize: 28 },
};

/** The four platform looks. `label` prints its wording on a `default` track. */
export type SwitchLook = 'ios' | 'android' | 'material' | 'default';

export const lookOf = (variant?: string): SwitchLook => {
  if (variant === 'ios') return 'ios';
  if (variant === 'android') return 'android';
  if (variant === 'material') return 'material';
  return 'default';
};

/** Track geometry once the caller's overrides and the size preset are combined. */
export const geometryOf = (size: SizeValue | undefined, width?: number, height?: number): SwitchGeometry => {
  const preset = SWITCH_SIZES[size as SizeValue] ?? SWITCH_SIZES.md;
  return { ...preset, width: width || preset.width, height: height || preset.height };
};

/**
 * The thumb's corner. `'50%'` is what the web emits; a renderer with no
 * percentage radius asks {@link thumbRadius} for the px instead.
 */
export const THUMB_RADIUS: Record<SwitchLook, (thumbSize: number) => number | string> = {
  ios: () => '50%',
  android: () => 4,
  material: (thumbSize) => thumbSize / 3,
  default: () => '50%',
};

export const TRACK_RADIUS: Record<SwitchLook, (height: number) => number> = {
  ios: (height) => height / 2,
  android: (height) => height / 3,
  material: (height) => height / 2.5,
  default: (height) => height / 2,
};

/** The web's `'50%'` as the px a circle of this size needs. */
export const thumbRadius = (look: SwitchLook, thumbSize: number): number => {
  const radius = THUMB_RADIUS[look](thumbSize);
  return typeof radius === 'number' ? radius : thumbSize / 2;
};

/**
 * The elevation the thumb rests at per look — an INDEX into `theme.shadows`,
 * not the shadow itself, so a host that re-themes MUI's elevations keeps
 * moving the web. {@link MUI_SHADOWS} carries MUI's own values for the native
 * side, which has no `theme.shadows` to read.
 */
export const THUMB_ELEVATION: Record<SwitchLook, number> = { ios: 0, android: 3, material: 2, default: 2 };

export const MUI_SHADOWS: Record<number, string> = {
  2: '0px 3px 1px -2px rgba(0,0,0,0.2),0px 2px 2px 0px rgba(0,0,0,0.14),0px 1px 5px 0px rgba(0,0,0,0.12)',
  3: '0px 3px 3px -2px rgba(0,0,0,0.2),0px 3px 4px 0px rgba(0,0,0,0.14),0px 1px 8px 0px rgba(0,0,0,0.12)',
};

/** The iOS thumb's own three-layer shadow, which the web writes out literally. */
export const IOS_THUMB_SHADOW = `0 3px 1px 0 ${alpha(SWITCH_BLACK, 0.04)}, 0 3px 8px 0 ${alpha(SWITCH_BLACK, 0.12)}, 0 1px 0 0 ${alpha(SWITCH_BLACK, 0.08)}`;

/** The iOS track's inset hairline. */
export const iosTrackShadow = (): string =>
  `inset 0 0 0 0.5px ${alpha(SWITCH_BLACK, 0.1)}, inset 0 2px 3px ${alpha(SWITCH_BLACK, 0.12)}`;

/** The resting track: a black wash on iOS, the disabled ink elsewhere. */
export const TRACK_ALPHA = { ios: 0.1, android: 0.2, other: 0.3 } as const;

/**
 * `black` is MUI's `palette.common.black` on the web and {@link SWITCH_BLACK}
 * on native, whose theme has no `common` — the same `#000` either way, passed
 * in rather than assumed so a host that themes it still moves the web.
 */
export const trackColor = (ink: { black: string; disabled: string }, look: SwitchLook): string => {
  if (look === 'ios') return alpha(ink.black, TRACK_ALPHA.ios);
  const strength = look === 'android' ? TRACK_ALPHA.android : TRACK_ALPHA.other;
  return alpha(ink.disabled, strength);
};

/** How far the thumb travels, and where it starts. iOS insets differently. */
export const thumbTravel = (look: SwitchLook, geometry: SwitchGeometry): { rest: number; travel: number } => {
  const { width, thumbSize, padding } = geometry;
  if (look === 'ios') {
    // The web nudges the whole switch base 2px right and shortens the trip.
    return { rest: padding + IOS_BASE_OFFSET, travel: width - thumbSize - IOS_TRAVEL_INSET };
  }
  return { rest: padding, travel: width - thumbSize - padding * 2 };
};

export const IOS_BASE_OFFSET = 2;
export const IOS_TRAVEL_INSET = 4;

/** MUI's 300ms `cubic-bezier(0.4, 0, 0.2, 1)`, on everything the switch moves. */
export const SWITCH_TRANSITION = { ms: 300, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' } as const;

/** The disabled treatment: the thumb greys and the track fades. */
export const DISABLED = { trackOpacity: 0.3, checkedTrackOpacity: 0.5, thumbGrey: 100 } as const;

/** `glass`: a paper wash under a blur, inside a faint divider hairline. */
export const SWITCH_GLASS = {
  trackAlpha: 0.1,
  thumbAlpha: 0.9,
  borderAlpha: 0.2,
  trackBlur: 20,
  thumbBlur: 10,
} as const;

/** `gradient`: the checked track runs light → main → dark; the resting one is fainter. */
export const SWITCH_GRADIENT = {
  checked: { angleDeg: 90, stops: [0, 50, 100] },
  resting: { angleDeg: 135, lightAlpha: 0.3, mainAlpha: 0.2 },
  shimmerMs: 3000,
} as const;

/** `glow`: a halo of the hue around the checked track, breathing every two seconds. */
export const SWITCH_GLOW = { blur: 10, alpha: 0.6, insetBlur: 10, insetAlpha: 0.2, ms: 2000 } as const;

/** `pulse`: the thumb breathes; `ripple`: a wash of the hue expands under the pointer. */
export const SWITCH_PULSE = { ms: 2000, minOpacity: 0.7, minScale: 0.95 } as const;
export const SWITCH_RIPPLE = { alpha: 0.2, ms: 600, scale: 2 } as const;

/** `loading`: a 2px ring inside the thumb, turning once a second. */
export const SWITCH_SPINNER = { sizeRatio: 0.6, borderWidth: 2, ms: 1000 } as const;

/** The two icons overlaid on the track, at their own size per step of the scale. */
export const SWITCH_ICON_SIZES: Record<SizeValue, number> = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20 };
/** Where a shown icon sits, and how small a hidden one is drawn. */
export const SWITCH_ICON = { inset: 4, hiddenScale: 0.8 } as const;

/** The wording the `label` variant prints inside the track: 0.75rem at 500, 8px in. */
export const TRACK_LABEL = { fontSize: 12, fontWeight: 500, insetUnits: 1 } as const;

/** MUI's `body2` for the label, `caption` for the description and the helper text. */
export const SWITCH_LABEL = { fontSize: 14, lineHeight: 1.43, fontWeight: 500 } as const;
export const SWITCH_DESCRIPTION = { fontSize: 12, lineHeight: 1.66, marginTopUnits: 0.5 } as const;
export const SWITCH_HELPER = { fontSize: 12, lineHeight: 1.66, marginTopUnits: 1 } as const;

/** The label row: 16px from the control beside it, 8px above or below it. */
export const LABEL_GAP_UNITS = { beside: 2, stacked: 1 } as const;

/**
 * `neutral`'s three greys, and the literals the web falls back to for a theme
 * whose grey ramp omits a step. Same three steps `Button` draws its neutral
 * from.
 */
export const NEUTRAL_GREY = { main: 700, dark: 800, light: 500 } as const;
export const NEUTRAL_FALLBACK = { main: '#616161', dark: '#424242', light: '#9e9e9e' } as const;
export const NEUTRAL_CONTRAST = '#fff';

/** Hover: the thumb lifts a shade and takes a halo of the hue. */
export const SWITCH_HOVER = { thumbScale: 1.05, elevation: 4, blur: 12, alpha: 0.2 } as const;

/** Focus: MUI rings the thumb rather than moving it. */
export const SWITCH_FOCUS_RING = { width: 6, alpha: 0.2 } as const;

/** A duration as the CSS the web has always emitted: `2000` → `2s`. */
export const seconds = (ms: number): string => `${ms / 1000}s`;

/** Whether this variant prints its wording inside the track. */
export const showsTrackLabels = (variant: SwitchVariant | undefined, onText?: string, offText?: string): boolean =>
  variant === 'label' && Boolean(onText ?? offText);
