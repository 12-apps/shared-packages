import type { ProgressSize } from './Progress.base';
import { contrastText, GREY, type UiPaletteColor, type UiTheme } from '../../../tokens/theme';
import type { ColorValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `Progress` RENDERERS DRAW WITH.
 *
 * `Progress.styles.ts` (web, emotion over MUI's `LinearProgress` and
 * `CircularProgress`) and `Progress.native.tsx` (React Native, with
 * `react-native-svg` for the arc) read this one table. The web turns the px
 * into rem and the shadows into CSS strings; native uses the numbers.
 *
 * The `CIRCULAR_*` group is MUI's OWN geometry, restated because the native
 * half draws the arc itself: a 44-unit viewBox whose circle is inset by the
 * stroke, with the value expressed as a dash offset — the same arithmetic
 * MUI's `CircularProgress` runs, so the two draw the same sweep.
 */
export interface ProgressSizeMetrics {
  /** The linear track's height, in px. The bar's radius is half of it. */
  height: number;
  /** The circular variant's diameter, in px. */
  circularSize: number;
  /** The label's type size, in px. */
  fontSize: number;
}

export const PROGRESS_SIZES: Record<ProgressSize, ProgressSizeMetrics> = {
  xs: { height: 2, circularSize: 24, fontSize: 10 },
  sm: { height: 4, circularSize: 32, fontSize: 12 },
  md: { height: 6, circularSize: 40, fontSize: 14 },
  lg: { height: 8, circularSize: 48, fontSize: 16 },
  xl: { height: 10, circularSize: 56, fontSize: 18 },
};

/** The unfilled track, and an unfilled segment: the hue at a tenth. */
export const TRACK_ALPHA = 0.1;

/** The label is MUI's `caption` at the size's own step, in semibold. */
export const LABEL_FONT_WEIGHT = 600;
/** `mt: 1` between a linear or segmented bar and its label. */
export const LABEL_MARGIN_TOP_UNITS = 1;
/** `gap: 0.5` between segments. */
export const SEGMENT_GAP_UNITS = 0.5;

/** `glass`: the hue at 80% behind a 10px blur, inside a 30% hairline. */
export const GLASS_BAR_ALPHA = 0.8;
export const GLASS_BAR_BORDER_ALPHA = 0.3;
export const GLASS_BLUR_PX = 10;

/** `glow` on a bar: `0 0 10px 2px alpha(main, 0.4)` and a 1.1 brightness lift. */
export const BAR_GLOW = { blur: 10, spread: 2, alpha: 0.4 } as const;
export const GLOW_BRIGHTNESS = 1.1;
/** `glow` on a filled segment: the same shadow, one step tighter. */
export const SEGMENT_GLOW = { blur: 6, spread: 1, alpha: 0.4 } as const;
/** `glow` on the circular arc: `drop-shadow(0 0 8px alpha(main, 0.6))`. */
export const CIRCULAR_GLOW = { blur: 8, alpha: 0.6 } as const;

/** MUI's `pulseAnimation`: opacity 1 → 0.7 → 1, every two seconds. */
export const PULSE = { durationMs: 2000, dip: 0.7 } as const;

/** `transition: all 0.3s ease` on the bar and on every segment. */
export const TRANSITION_MS = 300;

/* ── MUI's `CircularProgress`, restated for the renderer that has no MUI ──── */

/** MUI's `SIZE`: the arc is drawn in a 44-unit box and scaled to the px size. */
export const CIRCULAR_VIEWBOX = 44;
/** MUI puts the determinate arc's start at twelve o'clock. */
export const CIRCULAR_ROTATION_DEG = -90;
/** The circumference of the circle a `thickness` leaves room for. */
export const circularCircumference = (thickness: number): number =>
  2 * Math.PI * ((CIRCULAR_VIEWBOX - thickness) / 2);
/** MUI's `strokeDashoffset`: the share of the circumference still to run. */
export const circularDashOffset = (value: number, thickness: number): number =>
  ((100 - value) / 100) * circularCircumference(thickness);

/**
 * MUI's indeterminate `CircularProgress` never closes the ring: it draws
 * roughly a fifth of it and spins. One turn every 1.4s, as MUI's
 * `circular-rotate` keyframes do.
 */
export const CIRCULAR_INDETERMINATE = { arc: 0.25, rotationMs: 1400 } as const;
/** MUI's `bar1Indeterminate` keyframes: 2.1s a lap, over about a third of the track. */
export const LINEAR_INDETERMINATE = { width: 0.35, durationMs: 2100 } as const;

/**
 * `neutral` has no palette slot of its own in MUI, so `Progress.styles.ts` has
 * always drawn it from three greys; `danger` is MUI's `error`, which is what
 * the shared theme calls `danger`. Same colours here.
 */
export function progressPalette(theme: UiTheme, color: ColorValue): UiPaletteColor {
  if (color === 'neutral') {
    return {
      light: GREY[300],
      main: GREY[500],
      dark: GREY[700],
      contrastText: contrastText(GREY[500]),
    };
  }
  return theme.palette[color];
}
