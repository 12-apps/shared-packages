import type { MuiTypeVariantName } from '../../../tokens/mui-type';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `LoadingState` RENDERERS DRAW WITH.
 *
 * `LoadingState.tsx` (MUI) and `LoadingState.native.tsx` (React Native) read
 * this one table. Spacing is in SPACING UNITS where the web writes
 * `theme.spacing(n)`, so a host with a different unit moves both renderers;
 * everything else is px.
 */

/** MUI's `CircularProgress` diameter per size. */
export const SPINNER_SIZES: Record<SizeValue, number> = {
  xs: 16,
  sm: 24,
  md: 40,
  lg: 56,
  xl: 64,
};

/** The MUI `Typography` variant the message is set in, per size. */
export const MESSAGE_TYPE: Record<SizeValue, MuiTypeVariantName> = {
  xs: 'body2',
  sm: 'body2',
  md: 'body1',
  lg: 'h6',
  xl: 'h6',
};

export const SKELETON_ROW_HEIGHT: Record<SizeValue, number> = {
  xs: 14,
  sm: 20,
  md: 28,
  lg: 36,
  xl: 44,
};

/** The spinner view: a centred column, `theme.spacing(6)` of padding, at least 200px tall. */
export const SPINNER_PADDING_UNITS = 6;
export const SPINNER_MIN_HEIGHT = 200;
/** Between the spinner and its message. */
export const SPINNER_GAP_UNITS = 2;

/** The skeleton view: full width, `theme.spacing(3)` of padding. */
export const SKELETON_PADDING_UNITS = 3;
/** Between rows (MUI `Stack spacing={2}`), and above the message (`mt: 2`). */
export const SKELETON_ROW_GAP_UNITS = 2;
export const SKELETON_MESSAGE_MARGIN_TOP_UNITS = 2;
export const SKELETON_RADIUS = 4;
/** The last row is short, so the block reads as a paragraph of text. */
export const SKELETON_LAST_ROW_WIDTH = '60%';
export const SKELETON_FULL_ROW_WIDTH = '100%';
/**
 * The house `Skeleton`'s `medium` intensity, which this component never
 * overrides: `alpha(text.primary, 0.13)` in light mode, `alpha(#fff, 0.13)`
 * in dark — and dark mode's `text.primary` IS `#fff`, so one expression
 * covers both.
 */
export const SKELETON_TINT_ALPHA = 0.13;

/**
 * iOS's `ActivityIndicator` has two sizes, `small` (20pt) and `large`
 * (36pt); a diameter from this threshold up draws `large`. Android and the
 * web take the exact px.
 */
export const IOS_LARGE_SPINNER_FROM = 40;
