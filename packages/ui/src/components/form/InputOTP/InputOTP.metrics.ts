/**
 * The numbers both renderers read (see `NATIVE.md`, "Numbers").
 *
 * Each box's type size, in design px, per size step; its side is the theme's
 * field height for that step (a square), its weight 600.
 */
export const OTP_FONT_PX: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
};

/** The gap between two boxes: MUI's `gap: 1`, one 8px spacing unit. */
export const OTP_GAP_PX = 8;

/** The border: 1px at rest, 2px focused (MUI's focused outline). */
export const OTP_BORDER = { rest: 1, focused: 2 } as const;

/**
 * `fit="width"` (FUT-4585): the gap between two boxes when they share the row's
 * width — the approved prototype's 6px, a little tighter than the default 8px
 * so six portrait boxes stay at least 40 wide on a 320 phone.
 */
export const OTP_FIT_GAP_PX = 6;

/** `fit="width"`: no box is narrower than this, however narrow the row. */
export const OTP_FIT_MIN_WIDTH_PX = 32;

/** `fit="width"`: no box is shorter than the 40px touch floor, whatever its size. */
export const OTP_FIT_MIN_HEIGHT_PX = 40;

/**
 * One box's size under `fit="width"`, for a row `rowWidth` wide holding
 * `length` boxes whose size step draws a field `side` tall.
 *
 * The box keeps the field's height (never under {@link OTP_FIT_MIN_HEIGHT_PX})
 * and takes an equal share of the row, less the gaps, for its width: floored
 * to a whole pixel so six of them never overflow the row, never wider than it
 * is tall (a wide row keeps squares) and never under
 * {@link OTP_FIT_MIN_WIDTH_PX}. A narrow row therefore draws PORTRAIT boxes
 * rather than dropping to a smaller size and its smaller type.
 */
export function otpFitBox(rowWidth: number, side: number, length: number): { width: number; height: number } {
  const height = Math.max(side, OTP_FIT_MIN_HEIGHT_PX);
  const count = Math.max(1, Math.floor(length));
  const share = Math.floor((rowWidth - (count - 1) * OTP_FIT_GAP_PX) / count);
  const width = Math.min(height, Math.max(OTP_FIT_MIN_WIDTH_PX, Number.isFinite(share) ? share : height));
  return { width, height };
}
