import { FIELD_BORDER_WIDTH } from '../../../tokens/field-height.core';
import type { SizeValue } from '../../../tokens/vocabulary';

/**
 * THE NUMBERS BOTH `InputOTP` RENDERERS DRAW WITH.
 *
 * `InputOTP.styles.ts` (web, over MUI's `TextField`) and `InputOTP.native.tsx`
 * (React Native) read this one table. The web turns the px into rem; native
 * uses the numbers as they are. A slot's SIDE is not here: it is the theme's
 * field height for the size (`tokens/field-height`), a square on both.
 */

/** Each slot's type, in design px. */
export const OTP_FONT_PX: Record<SizeValue, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
};

/** The slot's type weight: semibold, so a digit reads at a glance. */
export const OTP_FONT_WEIGHT = 600;

/** The space between two slots, in units of the theme's spacing (MUI's `gap: 1`, 8px). */
export const OTP_GAP_UNITS = 1;

/** The slot's border: the field's resting hairline, two px once focused (or a gradient ring). */
export const OTP_BORDER = {
  rest: FIELD_BORDER_WIDTH,
  focused: 2,
} as const;

/** `glass`'s wash over the paper colour. */
export const OTP_GLASS_ALPHA = 0.1;

/** `glass`'s backdrop blur, in px — the web's only; React Native has no backdrop filter. */
export const OTP_GLASS_BLUR = 20;
