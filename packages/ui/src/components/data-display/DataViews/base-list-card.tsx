"use client";

import { useTheme } from "@mui/material/styles";
import { type ReactNode } from "react";

import { Card } from "../../layout/Card";
import type { DescriptionItemProps } from "../DescriptionItem";
import { Box } from "../../../mui/Box";

import {
  cardSurfaceStyles,
  isActionable,
  isSelectable,
  slotTestIds,
  type CardSurfaceProps,
} from "./card-surface";
import { useDragItem } from "./data-views-drag";
import { DragSlot, SelectSlot } from "./base-list-card-gutters";
import { DENSITY_ROW_PADDING, type DataViewsDensity } from "./data-views-layout-context";
import { RAIL_COUNT, RAIL_GAP, railsTemplateFor, useListRails } from "./list-card-rails";
import {
  ListCardCaption,
  ListCardMeta,
  ListCardTail,
  META_BREAK,
  STACK_BREAK,
} from "./base-list-card-slots";

/**
 * THE "LISTA" LAYOUT'S CARD — {@link BaseCard}'s horizontal sibling.
 *
 * `ListBody` always described the shape it wanted ("a marker, a title, a
 * subtitle and a value on the right") and never provided it, so every host
 * hand-rolled a `<Box>` flex row: a tint for selection with no checkbox, fixed
 * `minWidth` columns that ignored density and never collapsed, no hover, no
 * focus ring, and a `borderBottom` fighting the gap between rows.
 *
 * THE LIST OWNS THE COLUMNS. Inside a {@link ListCardGroup} this card is
 * `grid-template-columns: subgrid` across the group's rails, so the value sits
 * on its own edge and cannot be shunted about by the width of the status chip
 * beside it. Standalone it falls back to the same template on its own. See
 * `list-card-rails`.
 *
 * IT ANSWERS ITS OWN WIDTH, not the viewport — a container query, because the
 * same row renders full-bleed on a phone, in a 300px board column, and beside a
 * filter panel that opens and closes. Below `STACK_BREAK` it leaves the shared
 * rails entirely and goes two-line, which is the standard mobile transaction
 * row and beats truncating everything: title + value, then subtitle + status.
 */

export interface BaseListCardProps extends CardSurfaceProps {
  /** A marker: avatar, thumbnail or status glyph. Earn the pixels — a generic
   *  icon repeated down fifty rows is noise. */
  leading?: ReactNode;
  /** First-class title. Rendered as the link when `href` is set. */
  title?: ReactNode;
  /** Secondary line under the title. */
  subtitle?: ReactNode;
  /**
   * Middle columns as labelled pairs — {@link DescriptionItem}s, not free-form
   * nodes, so a screen reader reads "Data, 05/08/2026" rather than four
   * unrelated strings. Stacked (label above value) by default.
   *
   * The FIRST rung of the collapse ladder: the only slot whose absence does not
   * stop the row being identified or acted on.
   */
  meta?: DescriptionItemProps[];
  /** Escape hatch for a middle section these pairs cannot express. */
  metaSlot?: ReactNode;
  /** The number this row is about. Its own rail, tabular figures, never truncated. */
  value?: ReactNode;
  /** A status chip or badge. Its own fixed slot, so it cannot move the value. */
  status?: ReactNode;
  /**
   * Inline actions — the one or two things done often enough to deserve a
   * button. Revealed on hover and `:focus-within` by default, so fifty rows of
   * buttons are not the resting state of the page.
   */
  actions?: ReactNode;
  /** Always show the inline actions, rather than on hover/focus. */
  actionsAlwaysVisible?: boolean;
  /** The 3-dots overflow menu, pinned to the end. Also opens on right-click. */
  menu?: ReactNode;
  /** What opens the overflow menu on right-click / long-press. */
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Extra content below the main row; spans every rail. */
  children?: ReactNode;
  /** Toggle this row's selection. Receives the raw event so a list can range-select. */
  onToggleSelect?: (event?: React.MouseEvent) => void;
  /** How much air the row gets. Vertical only — a full-width row cannot narrow. */
  density?: DataViewsDensity;
  /** Fine-grained size multiplier on top of `density`. */
  scale?: number;
  /** Flush style: a bottom rule instead of an outline. Row-only. */
  divider?: boolean;
  /** This row's id for drag purposes. Inert outside a `DragContainerProvider`. */
  dragId?: string | number;
}

/**
 * 3px, off the token scale on purpose.
 *
 * `Card`'s smallest step is 4px and its default 8px, both chosen for a TILE —
 * a surface nearly as tall as it is wide, where a generous corner reads as
 * softness. A 56px row is not that shape: the same corner runs most of the way
 * down both ends, so the outline curves away from the square checkbox and the
 * square thumbnail sitting inside it. 3px is enough to take the hard point off
 * the corner and not enough to be seen as a curve.
 *
 * `divider` rows override it back to 0 — a bottom rule has no corners to round.
 */
const ROW_RADIUS = "3px";

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

/** Geometry: the rails, the density padding, the two-line collapse. */
function rowSx(opts: {
  inGroup: boolean;
  gutters: { drag: boolean; select: boolean };
  metaColumns: number;
  pad: number;
  padY: number;
  divider: boolean;
  interactive: boolean;
  draggable: boolean;
}): Record<string, unknown> {
  const { inGroup, gutters, metaColumns, pad, padY, divider, interactive, draggable } = opts;
  return {
    position: "relative",
    borderRadius: ROW_RADIUS,
    display: "grid",
    // SUBGRID AND `container-type` CANNOT COEXIST on one element: containment
    // makes the box size independently of its parent, so the browser drops the
    // subgrid and every slot stacks into one column. (Observed exactly that —
    // computed `grid-template-columns: 1222px` on a card asking for subgrid.)
    //
    // So inside a group the GROUP is the query container and the row is the
    // subgrid; standalone, the row is both the container and its own grid.
    ...(inGroup
      ? { gridColumn: `span ${RAIL_COUNT}`, gridTemplateColumns: "subgrid" }
      : {
          containerType: "inline-size",
          gridTemplateColumns: railsTemplateFor(gutters, metaColumns),
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
    //                        [ status …………… ][  value ]
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
      '& > [data-slot="status"]': { gridArea: "2 / 3", justifyContent: "flex-start" },
      '& > [data-slot="value"]': { gridArea: "2 / 4", textAlign: "right" },
    },
    ...(divider
      ? { border: 0, borderRadius: 0, borderBottom: 1, borderBottomStyle: "solid", borderBottomColor: "divider" }
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
function metaShape(props: BaseListCardProps): { columns: number; present: boolean } {
  const columns = props.meta?.length ?? 0;
  return { columns, present: columns > 0 || props.metaSlot != null };
}

/**
 * Everything the row derives before it can render — extracted so the component
 * stays inside the size budget.
 */
function useRowShell(props: BaseListCardProps) {
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
    pad: 1 * scale,
    padY: DENSITY_ROW_PADDING[group?.density ?? props.density ?? "cozy"] * scale,
    // A card that navigates does so with a real anchor, so it takes no click
    // handler of its own — the stretched link IS the target.
    acts: props.onClick != null && props.href == null && actionable,
  };
}

/** The click/keyboard props a row that acts (but does not navigate) needs. */
function actionProps(onClick: (() => void) | undefined) {
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
function rowStyles(
  props: BaseListCardProps,
  shell: ReturnType<typeof useRowShell>,
): Record<string, unknown> {
  const { group, theme, selectable, drag, reserve, pad, padY, acts } = shell;
  return {
    ...cardSurfaceStyles(
      {
        ...props,
        selectable,
        shape: "row",
        state: drag.dragging ? "disabled" : props.state,
      },
      theme,
    ),
    ...rowSx({
      inGroup: group !== null,
      gutters: { drag: reserve || drag.draggable, select: reserve || selectable },
      metaColumns: metaShape(props).columns,
      pad,
      padY,
      divider: props.divider ?? false,
      interactive: acts || props.href != null,
      draggable: drag.draggable && drag.handleProps === undefined,
    }),
  };
}

export function BaseListCard(props: BaseListCardProps): React.JSX.Element {
  const { selected = false, href, onClick } = props;
  const shell = useRowShell(props);
  const { actionable, scale, selectable, slot, drag, reserve, pad, acts } = shell;
  const meta = metaShape(props);

  return (
    <Card
      variant="outlined"
      className={props.className}
      dataTestId={props.testId}
      aria-label={props["aria-label"]}
      aria-disabled={actionable ? undefined : true}
      onContextMenu={props.onContextMenu}
      {...(acts ? actionProps(onClick) : {})}
      {...drag.itemProps}
      // A PLAIN OBJECT: `Card` merges by spreading, so a function sx vanishes.
      sx={rowStyles(props, shell)}
    >
      <DragSlot drag={drag} reserve={reserve} testId={slot("drag")} />
      <SelectSlot
        selectable={selectable}
        selected={selected}
        reserve={reserve}
        onToggleSelect={props.onToggleSelect}
        testId={slot("checkbox")}
      />
      <Box data-slot="leading" sx={{ display: "flex", alignItems: "center" }}>
        {props.leading}
      </Box>
      <ListCardCaption
        title={props.title}
        subtitle={props.subtitle}
        href={href}
        target={props.target}
        scale={scale}
        testId={slot("title")}
      />
      <ListCardMeta
        meta={props.meta}
        metaSlot={props.metaSlot}
        trailingRule={props.value != null}
      />
      <ListCardTail
        value={props.value}
        separated={meta.present}
        status={props.status}
        actions={actionable ? props.actions : undefined}
        actionsAlwaysVisible={props.actionsAlwaysVisible}
        menu={props.menu}
        scale={scale}
        testId={slot}
      />
      {props.children != null && (
        <Box sx={{ gridColumn: "1 / -1", mt: pad * 0.5, minWidth: 0 }}>{props.children}</Box>
      )}
    </Card>
  );
}

export { META_BREAK, STACK_BREAK };
