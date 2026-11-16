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
   * The dense step (FUT-4063), taken only when a measured figure fits and the
   * grid would otherwise turn round at a computer width: smaller type, thinner
   * gaps and row labels. How narrow a cell may be is NOT a number here: it is
   * the widest dense figure the host's `formatValueDense` makes, measured in
   * the table's own font, plus `figureMargin`. Row labels longer than the
   * 28px column are cut with an ellipsis (a 3-letter weekday fits).
   */
  denseFontSize: 9,
  denseLabelColumn: 28,
  denseGap: 1,
  /** Air a measured figure keeps inside its cell, both sides together (every step). */
  figureMargin: 1,
  /** Air between two column labels, so that they never touch. */
  denseLabelGap: 3,
  /** The dense header row's height: its labels are placed, so they give it none. */
  denseHeaderHeight: 14,
  swatch: 12,
  swatchRadius: 3,
  /**
   * An unmeasured cell's dashed ring, inset so the grid does not move: what
   * tells it apart from a "no sale" dash without colour or words.
   */
  unmeasuredRing: 1,
  unmeasuredRingInset: -3,
} as const;
