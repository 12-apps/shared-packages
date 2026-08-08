"use client";

import { Collapse } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useId, useState, type ReactNode } from "react";

import { Card } from "../../layout/Card";
import type { DescriptionItemProps } from "../DescriptionItem";
import { Box } from "../../../mui/Box";

import {
  CARD_RADIUS,
  cardSurfaceStyles,
  isActionable,
  isSelectable,
  slotTestIds,
  type CardSurfaceProps,
} from "./card-surface";
import { useDragItem } from "./data-views-drag";
import { DiscloseSlot, DragSlot, SelectSlot } from "./base-list-card-gutters";
import { DENSITY_ROW_PADDING, type DataViewsDensity } from "./data-views-layout-context";
import { RAIL_COUNT, RAIL_GAP, cellRailsTemplate, railsTemplateFor, useListRails } from "./list-card-rails";
import { ListCardCells, cellTracks, useCellConfig, type ListCardCellConfig } from "./list-card-cells";
import {
  ListCardActions,
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
  /**
   * THE EXPANDABLE BODY — and the whole reason this is a card and not a table
   * row.
   *
   * A summary row of labelled columns is a table row with a border round it: it
   * restates what the table already says and gives nobody a reason to switch to
   * it. What a card can do that a table cell cannot is OPEN — carry the record's
   * own detail underneath its summary, in whatever shape that record wants.
   *
   * So this container makes no claim about what goes in here. It spans every
   * rail and imposes nothing: an order puts its line items and a totals ledger
   * here, a cart adds its recovery actions, a role lists its permissions. The
   * design of that area belongs entirely to the consumer, and none of it is the
   * envelope's business.
   *
   * ABSENT ⇒ NO CHEVRON. A row given nothing to reveal renders no disclosure
   * control at all, rather than one that opens onto an empty box, so a column of
   * chevrons is a truthful index of which rows have more behind them.
   */
  children?: ReactNode;
  /** Open on first render, for an uncontrolled card. Ignored when `expanded` is set. */
  defaultExpanded?: boolean;
  /**
   * Open state, when the LIST wants to own it.
   *
   * Left unset the card keeps its own, and rows open independently — several at
   * once, which is what comparing two records requires. Pass this (with
   * `onExpandedChange`) to impose something else, an accordion being the usual
   * reason.
   */
  expanded?: boolean;
  /** Fired with the state the card is asking to move to. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Toggle this row's selection. Receives the raw event so a list can range-select. */
  onToggleSelect?: (event?: React.MouseEvent) => void;
  /** How much air the row gets. Vertical only — a full-width row cannot narrow. */
  density?: DataViewsDensity;
  /**
   * Fine-grained size multiplier on top of `density` (1 = base).
   *
   * Applied as `zoom`, so it scales EVERYTHING the row draws — type, gutters,
   * gaps, padding, the checkbox, the grip, the chip and the menu — not just the
   * handful of font sizes it once multiplied.
   */
  scale?: number;
  /** Flush style: a bottom rule instead of an outline. Row-only. */
  divider?: boolean;
  /** This row's id for drag purposes. Inert outside a `DragContainerProvider`. */
  dragId?: string | number;
  /**
   * The record this row is about, read by the list's cell config.
   *
   * Required only when cells are configured — the config's `primary`/`secondary`
   * are functions of the row, so without one there is nothing to render them
   * from and the card falls back to its named slots.
   */
  row?: Record<string, unknown>;
  /**
   * A cell config for a STANDALONE card.
   *
   * Inside a `ListCardGroup` the list's config wins and this is ignored: one
   * declaration of the list's shape is the whole point, and a row permitted to
   * override it could put its columns somewhere no other row has them.
   */
  cells?: readonly ListCardCellConfig<never>[];
}



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
function rowSx(opts: {
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
  cellTemplate: string | null,
): Record<string, unknown> {
  const { group, theme, selectable, drag, reserve, pad, padY, scale, acts } = shell;
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

/**
 * The row's open state, whether it owns it or the list does.
 *
 * Controlled the moment `expanded` is passed, so a list imposing an accordion
 * is never fighting a second copy of the truth inside each row. Uncontrolled
 * otherwise, and rows then open independently — which is what comparing two
 * records side by side actually needs.
 */
function useDisclosure(props: BaseListCardProps): {
  expandable: boolean;
  expanded: boolean;
  toggle: () => void;
  regionId: string;
} {
  const [own, setOwn] = useState(props.defaultExpanded ?? false);
  const controlled = props.expanded != null;
  const expanded = controlled ? props.expanded === true : own;
  // `useId` rather than a counter: the id has to survive an SSR pass and match
  // on hydration, or `aria-controls` points at nothing on the first paint.
  const regionId = useId();
  return {
    expandable: props.children != null,
    expanded,
    regionId,
    toggle: () => {
      if (!controlled) setOwn((open) => !open);
      props.onExpandedChange?.(!expanded);
    },
  };
}

export function BaseListCard(props: BaseListCardProps): React.JSX.Element {
  const { selected = false, href, onClick } = props;
  const shell = useRowShell(props);
  const { actionable, selectable, slot, drag, reserve, pad, acts } = shell;
  const meta = metaShape(props);
  const disclosure = useDisclosure(props);
  // The list's config wins over the card's: one declaration of the list's shape
  // is the point, so a row inside a group cannot introduce a column of its own.
  const groupCells = useCellConfig();
  const cells = groupCells ?? props.cells ?? null;
  const configured = cells != null && cells.length > 0 && props.row != null;
  // Standalone only. Inside a group the GROUP owns the template and the row is
  // subgrid over it — a row resolving its own tracks there is exactly what stops
  // a list from lining up.
  const cellTemplate =
    configured && shell.group == null ? cellRailsTemplate(cellTracks(cells)) : null;

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
      sx={rowStyles(props, shell, cellTemplate)}
    >
      <DiscloseSlot
        expandable={disclosure.expandable}
        expanded={disclosure.expanded}
        reserve={reserve}
        onToggle={disclosure.toggle}
        controls={disclosure.regionId}
        label={disclosure.expanded ? "Recolher detalhes" : "Expandir detalhes"}
        testId={slot("disclose")}
      />
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
      {configured ? (
        <>
          {/* The list's columns, rendered from this row. */}
          <ListCardCells cells={cells} row={props.row as never} />
          {/* THE MENU IS NOT PART OF THE CONFIG and never optional: it is where
            * a row's actions live, and a list that folded it into a cell would
            * have nowhere left to put them. So it brackets the cells, on its own
            * rail, exactly as the gutters do at the other end. */}
          <ListCardActions
            actions={actionable ? props.actions : undefined}
            alwaysVisible={props.actionsAlwaysVisible}
            menu={props.menu}
            testId={slot}
          />
        </>
      ) : (
        <>
          <ListCardCaption
            title={props.title}
            subtitle={props.subtitle}
            href={href}
            target={props.target}
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
            testId={slot}
          />
        </>
      )}
      {disclosure.expandable && (
        // `gridColumn: 1 / -1` so the body spans every rail: the summary's
        // columns are the LIST's, and nothing about them should constrain a
        // detail area whose design belongs to the consumer.
        //
        // Collapse rather than an unmount, so the body animates open and — more
        // importantly — keeps its own state between peeks. A consumer putting a
        // form or a scrolled table in here would otherwise have it reset every
        // time the row closed.
        //
        // `unmountOnExit` is deliberately NOT set: a list of fifty closed rows
        // pays for fifty hidden subtrees, which is the trade taken here because
        // the alternative re-runs every consumer's effects on each toggle.
        <Box sx={{ gridColumn: "1 / -1", minWidth: 0 }}>
          <Collapse in={disclosure.expanded} timeout={150}>
            <Box id={disclosure.regionId} role="region" sx={{ mt: pad * 0.5, minWidth: 0 }}>
              {props.children}
            </Box>
          </Collapse>
        </Box>
      )}
    </Card>
  );
}

export { META_BREAK, STACK_BREAK };
