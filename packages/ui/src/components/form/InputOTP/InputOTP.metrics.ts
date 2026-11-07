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
