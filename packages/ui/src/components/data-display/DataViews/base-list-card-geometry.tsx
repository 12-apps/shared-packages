"use client";

import { useTheme, type Theme } from "@mui/material/styles/index.js";

import {
  CARD_RADIUS,
  cardSurfaceStyles,
  isActionable,
  isSelectable,
  slotTestIds,
} from "./card-surface";
import { useDragItem } from "./data-views-drag";
import { DENSITY_ROW_PADDING } from "./data-views-layout-context";
import { RAIL_COUNT, RAIL_GAP, railsTemplateFor, useListRails } from "./list-card-rails";
import { COMPACT_BREAK, STACK_BREAK } from "./base-list-card-slots";
import type { BaseListCardProps } from "./base-list-card";
import { rem } from "../../../tokens/relative";

/**
 * THE ROW'S GEOMETRY AND SURFACE, split from the component at the size gate.
 *
 * Everything here answers "what shape is this row, and where do its slots land"
 * — the rails, the density padding, the two-line collapse, the drag and
 * selection plumbing. None of it renders anything, which is why the two halves
 * can live apart without either becoming harder to follow.
 */
/**
 * Whether a click was really a click, or the tail of a text selection.
 *
 * Without this, selecting an order id to copy it navigates away instead — the
 * single most annoying thing a clickable row does.
 */
function isTextSelection(): boolean {
  return (globalThis.getSelection?.()?.toString().length ?? 0) > 0;
}

/** Keyboard equivalence for a card that acts but does not navigate. */
function clickKeys(onClick: () => void) {
  return (event: React.KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onClick();
  };
}

/**
 * Geometry: the rails, the density padding, the two-line collapse.
 *
 * SCALE IS `zoom`, NOT A SET OF MULTIPLIED FONT SIZES.
 *
 * It used to be the latter, on exactly three values — title, value, row padding
 * — so the slider left the subtitle, the meta labels, the rules, the checkbox,
 * the grip, the chip and the menu at their fixed sizes, and the row came apart
 * as you dragged it. Multiplying the rest is not a fix: the checkbox and the
 * chip are MUI internals sized in their own px, and no prop we pass reaches
 * them.
 *
 * `zoom` scales the used value of every length in the subtree — ours and theirs
 * — and unlike `transform: scale` it REFLOWS, so the row still occupies the
 * space it draws and the rails still resolve. Verified against the group: at
 * 1.4 all four rows keep identical rail edges, because subgrid tracks and the
 * zoom that reads them are the same for every row.
 */
/** What {@link rowSx} needs to know about the row it lays out. */
interface RowSxOptions {
  inGroup: boolean;
  railCount: number;
  cellTemplate: string | null;
  /** A standalone configured row's template in the compact band. */
  compactTemplate: string | null;
  gutters: { disclose: boolean; drag: boolean; select: boolean };
  metaColumns: number;
  pad: number;
  padY: number;
  scale: number;
  divider: boolean;
  interactive: boolean;
  draggable: boolean;
  /** What the two-line layout below `STACK_BREAK` has to place by name. */
  stack: StackPlacement;
}

/**
 * The slots the stacked row places that the named-slot rules cannot know about.
 *
 * For a CONFIGURED row, `firstCell` is the cell that takes the title's place and
 * `valueCell` the one that takes the value's (null for a named-slot row, or for
 * a one-cell row with no value to show). `expandable` decides whether the
 * disclosure button gets a place or, when it is only a reserved empty gutter,
 * none at all.
 */
export interface StackPlacement {
  firstCell: string | null;
  valueCell: string | null;
  expandable: boolean;
}

/** A `[data-slot="cell-<id>"]` child selector, quoted so any id is safe. */
const cellSlot = (id: string): string => `& > [data-slot=${JSON.stringify(`cell-${id}`)}]`;

/**
 * A configured row, stacked, keeps the SAME two facts a named-slot row keeps:
 * what the record is (the first cell, in the title's place on line 1) and the
 * figure it is about (the value cell, on line 2 from under the title to the
 * right edge, where an `end` cell sits flush right). Every other cell goes, as
 * `meta` goes — a row is a fixed-height scanning unit, and what does not fit
 * belongs in its expandable body.
 *
 * Left to auto-placement these cells had flowed into whatever track was free:
 * a name squeezed beside the glyph, an amount clipped to "R$ …".
 *
 * The hide-all rule comes first and the two named cells after it: the
 * selectors have equal specificity, so the later rule wins for those cells.
 */
function stackedCells(stack: StackPlacement): Record<string, unknown> {
  if (stack.firstCell == null) return {};
  return {
    '& > [data-slot^="cell-"]': { display: "none" },
    [cellSlot(stack.firstCell)]: { display: "flex", gridArea: "1 / 3" },
    ...(stack.valueCell == null ? {} : { [cellSlot(stack.valueCell)]: { display: "flex", gridArea: "2 / 3 / 3 / 5" } }),
  };
}

/**
 * TWO-LINE, below the point where the shared rails stop helping.
 *
 * The standard mobile transaction row: what the record IS on the first line,
 * what it COSTS under it at the right edge. Better than
 * truncating four columns into ellipses, and the reason each slot carries a
 * `data-slot` — the placement is explicit rather than whatever order the
 * children happen to be in.
 *
 *   [ select ][ leading ][ title …………… ][   menu ]
 *   [ (disclose) ]       [ (cells) …………… ][  value ]
 *
 * The MENU stays in the top-right corner at every width. It is the row's
 * one fixed landmark — an overflow that moves to the second line on a phone
 * is an overflow nobody finds twice.
 */
const stackedRowSx = (inGroup: boolean, railCount: number, stack: StackPlacement): Record<string, unknown> => ({
  gridTemplateColumns: "auto auto minmax(0, 1fr) max-content",
  // The GROUP's track count, which a configured list sets from its cells
  // (`cellRailCount`) — not the named-slot RAIL_COUNT, which over-spans a
  // configured group and adds an implicit track at its end.
  ...(inGroup ? { gridColumn: `span ${railCount}` } : {}),
  rowGap: 0.75,
  columnGap: 1,
  '& > [data-slot="drag"]': { display: "none" },
  // The disclosure button, when there is one, under the checkbox: the head of
  // the row, where it sits at every other width — never beside the menu, where
  // it read as an "open" arrow. A reserved empty gutter takes no place at all.
  '& > [data-slot="disclose"]': stack.expandable ? { gridArea: "2 / 1", justifySelf: "center" } : { display: "none" },
  '& > [data-slot="select"]': { gridArea: "1 / 1" },
  '& > [data-slot="leading"]': { gridArea: "1 / 2" },
  '& > [data-slot="caption"]': { gridArea: "1 / 3" },
  '& > [data-slot="actions"]': { gridArea: "1 / 4", justifyContent: "flex-end" },
  '& > [data-slot="meta"]': { display: "none" },
  // Second line, starting under the title rather than under the checkbox.
  '& > [data-slot="value"]': { gridArea: "2 / 4", textAlign: "right" },
  ...stackedCells(stack),
});

/**
 * DIVIDER COMPOSES WITH THE VARIANT — it changes the row's SHAPE, not its
 * surface.
 *
 * It used to set `border: 0` and hard-code its own rule colour, which discarded
 * whatever the variant had drawn: `outline`, `text` and `ghost` all collapsed
 * to one identical flush row, and the variant control silently stopped meaning
 * anything the moment `divider` was on.
 *
 * Now only the GEOMETRY changes here — the box's sides go, one edge stays — and
 * no `borderColor` is written, so the colour set by `cardSurfaceStyles` survives.
 * A variant that draws no border of its own gets the neutral rule from
 * {@link rowStyles}.
 */
export const rowSx = (theme: Theme, opts: RowSxOptions): Record<string, unknown> => {
  const { inGroup, railCount, cellTemplate, compactTemplate, gutters, metaColumns, pad, padY, scale, divider, interactive, draggable, stack } = opts;
  return {
    position: "relative",
    borderRadius: CARD_RADIUS,
    display: "grid",
    zoom: scale,
    // SUBGRID AND `container-type` CANNOT COEXIST on one element: containment
    // makes the box size independently of its parent, so the browser drops the
    // subgrid and every slot stacks into one column. (Observed exactly that —
    // computed `grid-template-columns: 1222px` on a card asking for subgrid.)
    //
    // So inside a group the GROUP is the query container and the row is the
    // subgrid. Standalone, the row is its own grid but NOT its own container:
    // a container query matches an ANCESTOR, never the element itself, so a
    // row that was its own container placed its children for two lines while
    // its own template stayed wide. A standalone card renders inside a wrapper
    // that is the container (`BaseListCard`).
    ...(inGroup
      ? { gridColumn: `span ${railCount}`, gridTemplateColumns: "subgrid" }
      : { gridTemplateColumns: cellTemplate ?? railsTemplateFor(gutters, metaColumns) }),
    alignItems: "center",
    // Wide enough that the meta cluster, the value and the status read as three
    // columns rather than one run of text — the complaint that started all this
    // was `MÉTODO PIX R$ 13,90` scanning as a single phrase.
    columnGap: RAIL_GAP,
    width: "100%",
    px: pad,
    py: padY,
    cursor: draggable ? "grab" : interactive ? "pointer" : undefined,
    ...(draggable ? { touchAction: "none", "&:active": { cursor: "grabbing" } } : {}),
    ...(interactive ? { "&:hover": { backgroundColor: "action.hover" } } : {}),
    // A real focus ring, which a clickable <div> never had.
    "&:focus-visible": {
      outline: `${rem(theme, 2)} solid`,
      outlineStyle: "solid",
      outlineColor: "primary.main",
      outlineOffset: rem(theme, 2),
    },
    // COMPACT below COMPACT_BREAK: half the rail gap and, standalone, the
    // first cell's double share. In a group the GROUP's template answers the
    // width (`list-card-group-tracks`); the gap is the row's, since a subgrid
    // sets its own. BEFORE the stacked rule, which overrides it below
    // STACK_BREAK by coming later.
    [`@container (max-width: ${rem(theme, COMPACT_BREAK)})`]: {
      columnGap: RAIL_GAP / 2,
      ...(compactTemplate == null ? {} : { gridTemplateColumns: compactTemplate }),
    },
    // TWO-LINE below STACK_BREAK: see {@link stackedRowSx}.
    [`@container (max-width: ${rem(theme, STACK_BREAK)})`]: stackedRowSx(inGroup, railCount, stack),
    ...(divider
      ? { borderRadius: 0, borderWidth: 0, borderBottomWidth: 1, borderStyle: "solid" }
      : {}),
  };
};

/**
 * A selectable full-width row: a marker, a title over a subtitle, labelled
 * middle columns, a value, a status, actions and a menu.
 *
 * A SHELL, like {@link BaseCard}. Domain rows live in the app and compose it.
 */
/**
 * The id this row drags under, or nothing.
 *
 * `undefined` is the inert answer: `useDragItem` treats a missing id as "no
 * drag", which is how the card's own veto (`draggable={false}`) and an
 * unactionable record both switch dragging off without the card knowing
 * anything about the container above it.
 */
function dragIdFor(
  props: BaseListCardProps,
  actionable: boolean,
): string | number | undefined {
  return props.draggable === false || !actionable ? undefined : props.dragId;
}

/**
 * What the meta cluster amounts to — asked once, used three times: to size the
 * rail, to close the cluster with a rule, and to decide whether the value has
 * anything to be divided FROM.
 */
export function metaShape(props: BaseListCardProps): { columns: number; present: boolean } {
  const columns = props.meta?.length ?? 0;
  return { columns, present: columns > 0 || props.metaSlot != null };
}

/**
 * Everything the row derives before it can render — extracted so the component
 * stays inside the size budget.
 */
export function useRowShell(props: BaseListCardProps) {
  const actionable = isActionable(props.state);
  const group = useListRails();
  const scale = props.scale ?? 1;
  return {
    group,
    actionable,
    scale,
    theme: useTheme(),
    selectable: isSelectable(props),
    slot: slotTestIds(props.testId),
    drag: useDragItem(dragIdFor(props, actionable)),
    // Standalone holds no gutter open: there is no list beside it to line up
    // with, so a reserved-but-empty rail is pure inset. In a group every gutter
    // renders, empty when unused, and the GROUP decides whether its track
    // stays (`list-card-group-tracks`): the rows cannot agree among themselves.
    reserve: group != null,
    // 1, not 1.5. The row's contents still have to line up with the toolbar
    // above them, but 12px of card padding stacked on the checkbox's own 9px
    // and an empty drag gutter's 24px read as a row indented for no reason.
    //
    // Not multiplied by `scale` — the row's `zoom` already scales it, and doing
    // both would square the factor on padding alone.
    pad: 1,
    padY: DENSITY_ROW_PADDING[group?.density ?? props.density ?? "cozy"],
    // A card that navigates does so with a real anchor, so it takes no click
    // handler of its own — the stretched link IS the target.
    acts: props.onClick != null && props.href == null && actionable,
  };
}

/** The click/keyboard props a row that acts (but does not navigate) needs. */
export function actionProps(onClick: (() => void) | undefined) {
  return {
    role: "button",
    tabIndex: 0,
    onClick: () => {
      if (isTextSelection()) return;
      onClick?.();
    },
    onKeyDown: clickKeys(() => onClick?.()),
  };
}

/** The surface and the geometry, merged — the row's whole `sx` in one place. */

/**
 * The row's painted surface, plus the divider's colour fallback.
 *
 * A variant with no border of its own (`text`, `ghost`) would draw its rule in
 * the inherited colour — the TEXT colour, i.e. a black bar across the row. The
 * neutral divider token is supplied only in that case; a variant that has a
 * border keeps it, which is the whole point of composing the two.
 */
function rowSurface(
  props: BaseListCardProps,
  shell: ReturnType<typeof useRowShell>,
): Record<string, unknown> {
  const { theme, selectable, drag } = shell;
  const surface = cardSurfaceStyles(
    { ...props, selectable, shape: "row", state: drag.dragging ? "disabled" : props.state },
    theme,
  );
  if (props.divider !== true || surface.borderColor != null) return surface;
  return { ...surface, borderBottomColor: theme.palette.divider };
}

/**
 * Which head gutters this row renders: the ones it uses, or all three inside a
 * group (empty when unused; the group decides which keep a track). The template
 * is built from this; the three gutter slots
 * (`base-list-card-gutters.tsx`) apply the SAME conditions on their own — keep
 * the two in step, because a template that disagrees with the slots is exactly
 * how cells slid two tracks.
 */
export function rowGutters(
  props: BaseListCardProps,
  shell: ReturnType<typeof useRowShell>,
): { disclose: boolean; drag: boolean; select: boolean } {
  const { selectable, drag, reserve } = shell;
  return {
    disclose: reserve || props.children != null,
    drag: reserve || drag.draggable,
    select: reserve || selectable,
  };
}

export function rowStyles(
  props: BaseListCardProps,
  shell: ReturnType<typeof useRowShell>,
  templates: { cellTemplate: string | null; compactTemplate: string | null },
  stack: StackPlacement,
): Record<string, unknown> {
  const { theme, group, drag, pad, padY, scale, acts } = shell;
  return {
    ...rowSurface(props, shell),
    ...rowSx(theme, {
      inGroup: group !== null,
      railCount: group?.railCount ?? RAIL_COUNT,
      ...templates,
      gutters: rowGutters(props, shell),
      metaColumns: metaShape(props).columns,
      pad,
      padY,
      scale,
      divider: props.divider ?? false,
      interactive: acts || props.href != null,
      draggable: drag.draggable && drag.handleProps === undefined,
      stack,
    }),
  };
}
