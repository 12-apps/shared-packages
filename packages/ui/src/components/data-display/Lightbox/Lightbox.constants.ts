export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 5;
export const ZOOM_STEP = 1.2;
// Each wheel notch is ~100 deltaY, so this makes one notch a 1x zoom change.
export const WHEEL_ZOOM_FACTOR = 0.01;

export const DEFAULT_AUTOPLAY_INTERVAL_MS = 4000;
export const MIN_SWIPE_DISTANCE = 50;
export const OVERLAY_Z_INDEX = 1000;

const SCRIM = 'rgba(0, 0, 0, 0.5)';
const SCRIM_HOVER = 'rgba(0, 0, 0, 0.7)';

export const overlayButtonSx = {
  color: 'white',
  backgroundColor: SCRIM,
  '&:hover': { backgroundColor: SCRIM_HOVER },
} as const;

// The arrows drop their hover treatment at the ends of a non-looping gallery and
// dim instead, so a disabled arrow does not look pressable.
export const navButtonSx = {
  color: 'white',
  backgroundColor: SCRIM,
  '&:hover:not(:disabled)': { backgroundColor: SCRIM_HOVER },
  '&:disabled': { color: 'rgba(255, 255, 255, 0.3)' },
} as const;

export const captionSx = {
  color: 'white',
  textAlign: 'center',
  backgroundColor: SCRIM_HOVER,
  borderRadius: 1,
} as const;

export const counterSx = {
  color: 'white',
  fontSize: '0.875rem',
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
