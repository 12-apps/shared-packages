/**
 * THE SHARE BAR'S NUMBERS (FUT-145), in px at the design scale; the web reads
 * them through `rem`/`sxRem`, and through `remPx` where the fit is computed.
 */
export const SHARE_BAR_METRICS = {
  /** The bar's default height. */
  height: 24,
  radius: 4,
  /** Between two segments, so neighbours of close colour still read as two. */
  gap: 2,
  /** The inline percent's type size, and the air either side of it. */
  fontSize: 12,
  padding: 4,
  swatch: 10,
  swatchRadius: 2,
} as const;
