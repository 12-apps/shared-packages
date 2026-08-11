/**
 * How a block's CELL is sized on the canvas, and how that size travels inward.
 *
 * Pure functions and constants, deliberately: the geometry is the part worth
 * asserting on — that a `1/3` block computes a third — and `report-grid.tsx`
 * cannot be imported by a plain unit test.
 */
import { blockHeightCss, REPORT_GRID_COLUMNS, responsiveSpan } from "../../layout";
import { GRID_GAP_PX } from "./report-surface";

/**
 * The width a `span`-column block occupies: identical to `grid-column: span N`
 * on a 12-column grid with the same gap.
 *
 * The half pixel is slack against sub-pixel rounding — it can only ever make a
 * row fit, never wrap early. It used to be handed straight back by `flex-grow`;
 * with the grow gone (see {@link blockCellSx}) a full row now measures up to a
 * few tenths of a pixel short of the canvas, which is below what a display can
 * draw and far cheaper than a row that wraps one block early.
 */
export function spanBasis(span: number): string {
  const gutters = (REPORT_GRID_COLUMNS - 1) * GRID_GAP_PX;
  return `calc(${span} * (100% - ${gutters}px) / ${REPORT_GRID_COLUMNS} + ${(span - 1) * GRID_GAP_PX}px - 0.5px)`;
}

/**
 * A box that grows into its flex parent's spare height, KEEPING its content
 * height as its floor (`flex-basis: auto`).
 *
 * That last part is the whole compatibility story of the fill chain: every box
 * between the cell and the rendering still measures its own content first and
 * merely takes any space left over, so a thirty-row table pushes the block
 * taller instead of being squashed into it. Only the chart itself opts out —
 * see {@link BLOCK_FILL_BODY_SX}.
 */
const FILLS = { flex: "1 1 auto", minHeight: 0 } as const;

/** …and lays its own children out down the same axis. */
const FILLS_AS_COLUMN = { ...FILLS, display: "flex", flexDirection: "column" } as const;

/**
 * The cell's height rules, when the block declares one (FUT-755).
 *
 * `minHeight`, never `height`: a thirty-row table in a `Baixa` block must
 * OUTGROW its tier rather than be clipped, because a report that hides data is
 * worse than one taller than it was asked to be. What a tier is worth on screen
 * is `layout.ts`'s (`blockHeightCss`) — a clamped share of the window rather
 * than a row count, because a canvas of wrapped flex rows has no row track and
 * an author has to be able to SEE the difference between two tiers.
 *
 * `& > *` reaches the cell's single child whatever it is: the viewer puts the
 * block frame there and the editor wraps it in a focusable group first, and
 * neither has to know it is inside a heighted cell.
 *
 * `undefined` when there is no height, so a block storing none is sized by
 * exactly the rules it always was. That is the compatibility guarantee, and it
 * is structural rather than a value that happens to agree.
 */
function heightRules(height: number | undefined): Record<string, unknown> | undefined {
  if (height === undefined) return undefined;
  return {
    minHeight: blockHeightCss(height),
    display: "flex",
    flexDirection: "column",
    "& > *": FILLS_AS_COLUMN,
  };
}

/**
 * One placed block's box: `span` columns wide, widened per tier below desktop,
 * and `height` rows tall when it declares one.
 *
 * **A BLOCK NEVER GROWS PAST ITS SPAN.** `flexGrow` was the span, so leftover
 * width on a row was handed back to the blocks in it in proportion — which
 * closed every last row and left no orphan hole (`visual-pass.md` §Layout).
 * That was a real trade someone chose on purpose, and it is recorded here
 * rather than deleted because the next person will be tempted to reinstate it.
 *
 * It was abandoned (FUT-755) because it silently overrode the author. A block
 * alone on its row is the ONLY block on that row, so it took all of it: an
 * author who picked `1/3` watched it render full width, and it narrowed to a
 * third only once a `2/3` sibling arrived to use the rest. A width picker whose
 * label does not describe what it draws is the same defect as an `Empilhado`
 * toggle that stacks nothing — the control claims something it does not do.
 * Between "no ragged last row" and "the width I chose", the chosen width wins,
 * and a partly-filled row now simply ends.
 *
 * The tier widening is NOT that rule and survives untouched: a third of a phone
 * is unreadable, so `responsiveSpan` widens the SPAN itself and the basis below
 * follows. That is a different span, honestly rendered — not a block stretched
 * past the one it was given.
 */
export function blockCellSx(span: number, height?: number): Record<string, unknown> {
  const phone = responsiveSpan(span, "phone");
  const tablet = responsiveSpan(span, "tablet");
  const desktop = responsiveSpan(span, "desktop");
  return {
    flexGrow: 0,
    // Still shrinkable: a row a fraction of a pixel over its canvas gives the
    // fraction back instead of wrapping its last block onto a line of its own.
    flexShrink: 1,
    flexBasis: { xs: spanBasis(phone), sm: spanBasis(tablet), lg: spanBasis(desktop) },
    minWidth: 0,
    maxWidth: "100%",
    ...heightRules(height),
  };
}

/** The block's card, when the cell it sits in has a height to give it. */
export const BLOCK_FILL_CARD_SX = FILLS_AS_COLUMN;

/**
 * The card's body slot — and the rest of the way down to the chart itself.
 *
 * A taller CELL is not a taller chart. The chart is several boxes down, and
 * every one of them measures its own content, so raising the block's floor
 * without changing anything inside it buys blank space under a chart that is
 * exactly the size it was. That is what the user saw when `Média` and `Alta`
 * rendered "almost nothing" apart, and it is what these three rules fix — the
 * height has to be handed all the way to the thing that draws.
 *
 * Each rule is one layer of a rendering, and each needs a different thing:
 *
 *  - `& > *` — the render view's own box (or the error `Alert` in its place).
 *  - `& > * > *` — the layer BELOW it: `SpecChart`'s own div, and a table's
 *    container. Two levels rather than one because the chain is two boxes
 *    deep, and a single missing `flex-direction: column` anywhere in it breaks
 *    the whole thing — a `flex` shorthand on a child of a BLOCK box is inert,
 *    so the chart silently keeps its preset height and the tier buys padding
 *    again. It is stated structurally rather than by naming a component's
 *    class or test id, neither of which layout should depend on.
 *  - `& .MuiPaper-root` — a rendering that wraps itself in a surface, wherever
 *    in the two levels it puts it.
 *  - `& .recharts-responsive-container` — the chart's own box, and the ONLY
 *    layer given `flex-basis: 0`. Recharts is handed a preset height by
 *    `ChartContainer` (`sm` = 300px) which it writes inline, and an inline
 *    style outranks every class — but a flex item's main size comes from its
 *    `flex-basis`, so a basis of zero makes that preset inert without fighting
 *    it for specificity. The chart then takes exactly the space the block has
 *    left, up OR down: it is the one layer whose intrinsic size is a default
 *    rather than content, so it is the one layer safe to override.
 *
 * `flex-basis: 0` is on the MAIN axis, which is only the height because every
 * box above it here is a `column`. That is what the two levels above are for,
 * and it is why they are asserted in `block-height-render.test.tsx` rather than
 * left to reading: a row anywhere in the chain would collapse the chart's WIDTH
 * instead, which looks like a chart that lost its axis labels.
 *
 * `ResponsiveContainer` measures its own box, so the chart redraws at whatever
 * flex resolves to — no percentage height has to resolve anywhere for this to
 * work, which is what makes it survive `minHeight` on the cell.
 */
export const BLOCK_FILL_BODY_SX = {
  ...FILLS_AS_COLUMN,
  "& > *": FILLS_AS_COLUMN,
  "& > * > *": FILLS_AS_COLUMN,
  "& .MuiPaper-root": FILLS_AS_COLUMN,
  "& .recharts-responsive-container": { flex: "1 1 0", minHeight: 0 },
} as const;
