/**
 * ONE TILE SHAPE, shared by `Largura` and `Altura` (FUT-755).
 *
 * Both size pickers laid their options out as a wrapping ROW of buttons, so
 * every tile was as wide as its own label: the full-canvas option came out
 * visibly bigger than `1/3`, `Alta` visibly smaller than the auto option, and
 * `Altura`'s four options wrapped 3-then-1 with the orphan narrower than the
 * three above it. A control whose options differ in size implies the options
 * differ in KIND, and here they are four settings of one property.
 *
 * So they are laid out the way `VizPicker`'s tiles are — a grid of equal
 * columns, each tile one column wide and one fixed height tall — and the two
 * pickers share these values so they also match EACH OTHER, which is how they
 * are seen: stacked one above the other in the same panel.
 *
 * The column floor is stated as a WIDTH rather than a column count, because
 * what a tile has to fit is its longest label. Shortening the two outliers to
 * `100%` and `Auto` — the rename the user asked for twice — is what let that
 * floor be genuinely compact instead of sized to one long word. Where a panel
 * is too narrow even for it, the grid drops a column and every tile GROWS,
 * which is the right way round: a uniform size is worth widening for, and it
 * is never worth a clipped label.
 */
import { CONTROL_RADIUS_PX } from "./report-surface";

/**
 * The narrowest a tile may be: enough for `Média`, the longest label either
 * picker draws, without wrapping or an ellipsis — and enough for the `n/12`
 * fallback a width with no simple name falls back to. Four fit across the
 * panel with room to spare, and each one is a square.
 */
export const SIZE_TILE_MIN_WIDTH_PX = 64;

/**
 * One height for every tile, in both pickers — fixed rather than derived from
 * the width, so a grid that drops from four columns to three does not also
 * change how tall the control is.
 */
export const SIZE_TILE_HEIGHT_PX = 64;

/**
 * The tallest a tile's preview bar may draw, leaving room for the label beneath
 * it inside {@link SIZE_TILE_HEIGHT_PX}. `Altura`'s bar scales with the tier,
 * so without a ceiling tied to the tile the tallest one would push its own
 * label out of the box.
 */
export const SIZE_TILE_BAR_MAX_PX = 28;

/**
 * Equal columns, as many as fit. `1fr` is what makes every tile the same width
 * — including a fifth, non-canonical one (a width stored at `5/12`) that lands
 * alone on a second row and used to be the odd button out.
 */
export const SIZE_TILE_GRID_SX = {
  display: "grid",
  gridTemplateColumns: `repeat(auto-fit, minmax(${SIZE_TILE_MIN_WIDTH_PX}px, 1fr))`,
  gap: 1,
} as const;

/**
 * One tile: the full column, the shared height, its preview bar above its
 * label. `minWidth: 0` stops the longest label from widening its own column
 * past the others — the floor above is what guarantees it still fits.
 */
export const SIZE_TILE_SX = {
  width: "100%",
  minWidth: 0,
  height: `${SIZE_TILE_HEIGHT_PX}px`,
  minHeight: `${SIZE_TILE_HEIGHT_PX}px`,
  flexDirection: "column",
  justifyContent: "center",
  gap: 0.5,
  px: 0.5,
  py: 0.75,
  // The control radius, not a fourth value (`visual-pass.md` §Components).
  borderRadius: `${CONTROL_RADIUS_PX}px`,
  lineHeight: 1.1,
} as const;

/** The label, at the caption step of the type scale, on one line. */
export const SIZE_TILE_LABEL_SX = {
  fontSize: "0.75rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
} as const;
