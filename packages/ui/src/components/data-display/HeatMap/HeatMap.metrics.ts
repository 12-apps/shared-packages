/**
 * THE HEAT MAP'S NUMBERS (FUT-4063), in px; the web reads them through
 * `rem`/`sxRem`, and through `remPx` where the fit is computed in JavaScript.
 */
export const HEAT_MAP_METRICS = {
  /** The row-label column: weekdays across, hours when transposed. */
  labelColumn: 44,
  labelColumnTransposed: 36,
  /** Between cells, both ways. */
  gap: 3,
  cellHeight: 30,
  cellHeightTransposed: 28,
  radius: 4,
  fontSize: 11,
  /** The compact step, taken only when the regular one cannot fit. */
  compactFontSize: 10,
  /**
   * The narrowest cell that shows its WHOLE figure: "123%" bold, tabular, at
   * `fontSize`, with a hair of air either side. Measured in Chromium (26.4px
   * at 11px, 24px at 10px), rounded up.
   */
  minCell: 32,
  compactMinCell: 28,
  swatch: 12,
  swatchRadius: 3,
} as const;
