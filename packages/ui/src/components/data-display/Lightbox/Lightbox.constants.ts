import type { Theme } from '@mui/material/styles/index.js';

import { onMedia, scrim, sheen } from '../../../tokens/ink';
import { remPx, sxRem } from '../../../tokens/relative';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 5;
export const ZOOM_STEP = 1.2;
// Each wheel notch is ~100 deltaY, so this makes one notch a 1x zoom change.
export const WHEEL_ZOOM_FACTOR = 0.01;

export const DEFAULT_AUTOPLAY_INTERVAL_MS = 4000;
export const OVERLAY_Z_INDEX = 1000;

/**
 * How far a finger must travel to count as a swipe: 50 design px, in the px a
 * touch event reports, so it moves with the theme's type scale.
 */
export const minSwipeDistance = (theme: Theme): number => remPx(theme, 50);

const SCRIM = (theme: Theme): string => scrim(theme, 0.5);
const SCRIM_HOVER = (theme: Theme): string => scrim(theme, 0.7);

export const overlayButtonSx = {
  color: onMedia,
  backgroundColor: SCRIM,
  '&:hover': { backgroundColor: SCRIM_HOVER },
} as const;

// The arrows drop their hover treatment at the ends of a non-looping gallery and
// dim instead, so a disabled arrow does not look pressable.
export const navButtonSx = {
  color: onMedia,
  backgroundColor: SCRIM,
  '&:hover:not(:disabled)': { backgroundColor: SCRIM_HOVER },
  '&:disabled': { color: (theme: Theme) => sheen(theme, 0.3) },
} as const;

export const captionSx = {
  color: onMedia,
  textAlign: 'center',
  backgroundColor: SCRIM_HOVER,
  borderRadius: 1,
} as const;

export const counterSx = {
  color: onMedia,
  fontSize: sxRem(14),
  backgroundColor: SCRIM,
  borderRadius: 1,
} as const;

export const thumbnailStripSx = {
  background: SCRIM,
  borderRadius: 1,
} as const;

// Every element gets `${dataTestId}-suffix` when the caller supplied an id, and
// `lightbox-suffix` otherwise.
export const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `lightbox-${suffix}`;
