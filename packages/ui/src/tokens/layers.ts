import type { Theme } from '@mui/material/styles';

/**
 * WHERE A PORTALLED OVERLAY SITS RELATIVE TO A STACK OF SHEETS.
 *
 * `StackedModal` does not put its panels on one layer. Each panel takes its own
 * z-index as it joins the stack — {@link MODAL_STACK_BASE_Z_INDEX} for the
 * first, another {@link MODAL_STACK_Z_INDEX_STEP} for every panel above it — so
 * the top of a two-deep stack sits at 1310, not at `zIndex.modal`.
 *
 * Anything that portals out of a panel has to clear that. MUI's own defaults do
 * not: a `Popover` (and therefore a `Menu`, and therefore a `Select`) renders at
 * `zIndex.modal`, and a temporary `Drawer` a step lower still at
 * `zIndex.drawer`. With exactly one sheet open the numbers tie and portal order
 * settles it in the overlay's favour, which is why this looks fine right up
 * until a second sheet opens over the first.
 *
 * ## What the failure looks like, because it is not "the panel is invisible"
 *
 * A `Popover` under a sheet is still a live modal. It takes focus into itself
 * and holds it, and its backdrop is under the sheet too — so no click can reach
 * the backdrop to dismiss it. The trigger flips its chevron, no panel appears,
 * and from that point every keystroke aimed at the rest of the form is swallowed
 * by an input nobody can see. One click on a field that looks inert leaves the
 * whole form inert. Reported downstream as three unrelated blocks being
 * "disabled" (12-57).
 *
 * ## Why this is a token and not a prop on each component
 *
 * The invariant belongs to the ladder, and the ladder is `StackedModal`'s. Left
 * to individual components it is a rule each one has to remember, and the ones
 * that did not remember are indistinguishable from the ones that did until a
 * consumer stacks a sheet. `CategorySelect` never had it and `Autocomplete`
 * answered the same question with `zIndex.tooltip` — three different heights for
 * one question, in one package.
 */

/** The z-index `StackedModal` gives the FIRST panel in a stack. */
export const MODAL_STACK_BASE_Z_INDEX = 1300;

/** How much higher each panel stacked on top of another one sits. */
export const MODAL_STACK_Z_INDEX_STEP = 10;

/**
 * How many stacked panels a portalled overlay is guaranteed to clear.
 *
 * Ten rather than a number derived from the deepest stack anyone has built,
 * because there is nothing to derive it from: a theme is resolved once, at paint
 * time, and knows nothing about how many sheets happen to be open. So the
 * headroom is a constant, and this is the depth it buys.
 */
export const STACKED_OVERLAY_CLEARED_LEVELS = 10;

/** The constant added to `zIndex.modal` to clear that many panels — 100. */
export const STACKED_OVERLAY_HEADROOM =
  MODAL_STACK_Z_INDEX_STEP * STACKED_OVERLAY_CLEARED_LEVELS;

/**
 * The z-index for a surface that portals out of a sheet and must stay on top of
 * it — a dropdown, a picker panel, a menu.
 *
 * Read from the theme rather than hardcoded so a host that has moved
 * `zIndex.modal` keeps the same relationship instead of a stale absolute.
 *
 * ```tsx
 * <Popover sx={{ zIndex: stackedOverlayZIndex }} … />
 * ```
 */
export const stackedOverlayZIndex = (theme: Theme): number =>
  theme.zIndex.modal + STACKED_OVERLAY_HEADROOM;
