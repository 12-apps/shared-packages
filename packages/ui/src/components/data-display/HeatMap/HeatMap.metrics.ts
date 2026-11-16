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
  /**
   * The dense step (FUT-4063), taken only when neither regular nor compact fits
   * and the grid would otherwise turn round at a computer width: the cell is
   * as narrow as a figure can be and still read, the labels thin out. The
   * floor is a 3-character figure ("54%", or "902" with the unit dropped) at
   * `denseFontSize`, bold and tabular, about 16px in Chromium, plus a hair.
   */
  denseMinCell: 17,
  denseFontSize: 9,
  denseLabelColumn: 32,
  denseGap: 2,
  /** The dense header row's height: its labels are placed, so they give it none. */
  denseHeaderHeight: 14,
  /** In the dense step the column labels show every Nth one; the rest are read, not drawn. */
  denseLabelEvery: 2,
  swatch: 12,
  swatchRadius: 3,
  /**
   * An unmeasured cell's dashed ring, inset so the grid does not move: what
   * tells it apart from a "no sale" dash without colour or words.
   */
  unmeasuredRing: 1,
  unmeasuredRingInset: -3,
} as const;
