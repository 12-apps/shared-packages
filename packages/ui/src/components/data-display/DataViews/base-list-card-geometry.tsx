"use client";

import { useTheme } from "@mui/material";

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
import { STACK_BREAK } from "./base-list-card-slots";
import type { BaseListCardProps } from "./base-list-card";

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
export function rowSx(opts: {
  inGroup: boolean;
  railCount: number;
  cellTemplate: string | null;
  gutters: { disclose: boolean; drag: boolean; select: boolean };
  metaColumns: number;
  pad: number;
  padY: number;
  scale: number;
  divider: boolean;
  interactive: boolean;
  draggable: boolean;
}): Record<string, unknown> {
  const { inGroup, railCount, cellTemplate, gutters, metaColumns, pad, padY, scale, divider, interactive, draggable } = opts;
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
    // subgrid; standalone, the row is both the container and its own grid.
    ...(inGroup
      ? { gridColumn: `span ${railCount}`, gridTemplateColumns: "subgrid" }
      : {
          containerType: "inline-size",
          gridTemplateColumns: cellTemplate ?? railsTemplateFor(gutters, metaColumns),
        }),
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
    "&:focus-visible": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main", outlineOffset: 2 },
    // TWO-LINE, below the point where the shared rails stop helping.
    //
    // The standard mobile transaction row: what the record IS and what it COST
    // on the first line, the supporting detail on the second. Better than
    // truncating four columns into ellipses, and the reason each slot carries a
    // `data-slot` — the placement is explicit rather than whatever order the
    // children happen to be in.
    //
    //   [ select ][ leading ][ title …………… ][   menu ]
    //                        [ (cells) …………… ][  value ]
    //
    // The MENU stays in the top-right corner at every width. It is the row's
    // one fixed landmark — an overflow that moves to the second line on a phone
    // is an overflow nobody finds twice.
    [`@container (max-width: ${STACK_BREAK}px)`]: {
      gridTemplateColumns: "auto auto minmax(0, 1fr) max-content",
      ...(inGroup ? { gridColumn: `span ${RAIL_COUNT}` } : {}),
      rowGap: 0.75,
      columnGap: 1,
      '& > [data-slot="drag"]': { display: "none" },
      '& > [data-slot="select"]': { gridArea: "1 / 1" },
      '& > [data-slot="leading"]': { gridArea: "1 / 2" },
      '& > [data-slot="caption"]': { gridArea: "1 / 3" },
      '& > [data-slot="actions"]': { gridArea: "1 / 4", justifyContent: "flex-end" },
      '& > [data-slot="meta"]': { display: "none" },
      // Second line, starting under the title rather than under the checkbox.
      '& > [data-slot="value"]': { gridArea: "2 / 4", textAlign: "right" },
    },
    ...(divider
      ? { borderRadius: 0, borderWidth: 0, borderBottomWidth: 1, borderStyle: "solid" }
      : {}),
  };
}

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
    // with, so a reserved-but-empty rail is pure inset.
    reserve: group?.reserveGutters ?? false,
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

export function rowStyles(
  props: BaseListCardProps,
  shell: ReturnType<typeof useRowShell>,
  cellTemplate: string | null,
): Record<string, unknown> {
  const { group, selectable, drag, reserve, pad, padY, scale, acts } = shell;
  return {
    ...rowSurface(props, shell),
    ...rowSx({
      inGroup: group !== null,
      railCount: group?.railCount ?? RAIL_COUNT,
      cellTemplate,
      gutters: {
        disclose: reserve || props.children != null,
        drag: reserve || drag.draggable,
        select: reserve || selectable,
      },
      metaColumns: metaShape(props).columns,
      pad,
      padY,
      scale,
      divider: props.divider ?? false,
      interactive: acts || props.href != null,
      draggable: drag.draggable && drag.handleProps === undefined,
    }),
  };
}
