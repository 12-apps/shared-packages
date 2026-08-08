"use client";

import { Collapse } from "@mui/material";
import { type ReactNode } from "react";

import { Card } from "../../layout/Card";
import type { DescriptionItemProps } from "../DescriptionItem";
import { Box } from "../../../mui/Box";

import { type CardSurfaceProps } from "./card-surface";
import { DropIndicator } from "./data-views-drag";
import { useDisclosure } from "./base-list-card-disclosure";
import { actionProps, metaShape, rowStyles, useRowShell } from "./base-list-card-geometry";
import { DiscloseSlot, DragSlot, SelectSlot } from "./base-list-card-gutters";
import { type DataViewsDensity } from "./data-views-layout-context";
import { cellRailsTemplate } from "./list-card-rails";
import { ListCardCells, cellTracks, useCellConfig, type ListCardCellConfig } from "./list-card-cells";
import {
  ListCardActions,
  ListCardCaption,
  ListCardMeta,
  ListCardTail,
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
 * Which cell config applies, and whether this row resolves its own tracks.
 *
 * The list's config wins over the card's: one declaration of the list's shape is
 * the point, so a row inside a group cannot introduce a column of its own. And
 * the template is standalone-only — inside a group the GROUP owns it and the row
 * is subgrid over it, because a row resolving its own tracks is exactly what
 * stops a list from lining up.
 */
function useResolvedCells(
  props: BaseListCardProps,
  inGroup: boolean,
): {
  cells: readonly ListCardCellConfig<never>[] | null;
  configured: boolean;
  cellTemplate: string | null;
} {
  const groupCells = useCellConfig();
  const cells = groupCells ?? props.cells ?? null;
  const configured = cells != null && cells.length > 0 && props.row != null;
  const cellTemplate = configured && !inGroup ? cellRailsTemplate(cellTracks(cells)) : null;
  return { cells, configured, cellTemplate };
}


/**
 * The row's middle: either the list's configured cells, or the named slots.
 *
 * Split out because the branch is the only conditional shape the card has, and
 * inlined it pushed `BaseListCard` past both the line and the complexity gate.
 */
function RowContent({
  card,
  cells,
  configured,
  slot,
  actionable,
  meta,
}: {
  card: BaseListCardProps;
  cells: readonly ListCardCellConfig<never>[] | null;
  configured: boolean;
  slot: (name: string) => string | undefined;
  actionable: boolean;
  meta: { columns: number; present: boolean };
}): React.JSX.Element {
  if (configured && cells != null) {
    return (
      <>
        {/* The list's columns, rendered from this row. */}
        <ListCardCells cells={cells} row={card.row as never} />
        {/* THE MENU IS NOT PART OF THE CONFIG and never optional: it is where a
          * row's actions live, and a list that folded it into a cell would have
          * nowhere left to put them. So it brackets the cells on its own rail,
          * exactly as the gutters do at the other end. */}
        <ListCardActions
          actions={actionable ? card.actions : undefined}
          alwaysVisible={card.actionsAlwaysVisible}
          menu={card.menu}
          testId={slot}
        />
      </>
    );
  }
  return (
    <>
      <ListCardCaption
        title={card.title}
        subtitle={card.subtitle}
        href={card.href}
        target={card.target}
        testId={slot("title")}
      />
      <ListCardMeta meta={card.meta} metaSlot={card.metaSlot} trailingRule={card.value != null} />
      <ListCardTail
        value={card.value}
        separated={meta.present}
        actions={actionable ? card.actions : undefined}
        actionsAlwaysVisible={card.actionsAlwaysVisible}
        menu={card.menu}
        testId={slot}
      />
    </>
  );
}

/**
 * The revealed body, and the rule that separates it from the summary.
 *
 * `gridColumn: 1 / -1` so it spans every rail: the summary's columns are the
 * LIST's, and nothing about them should constrain a detail area whose design
 * belongs to the consumer.
 *
 * Collapse rather than an unmount, so the body animates open and keeps its own
 * state between peeks — a consumer putting a form or a scrolled table in here
 * would otherwise have it reset on every toggle. `unmountOnExit` is deliberately
 * NOT set: fifty closed rows pay for fifty hidden subtrees, which is the trade
 * taken because the alternative re-runs every consumer's effects per toggle.
 */
function ExpandableBody({
  disclosure,
  padY,
  pad,
  children,
}: {
  disclosure: { expandable: boolean; expanded: boolean; regionId: string };
  padY: number;
  pad: number;
  children: ReactNode;
}): React.JSX.Element {
  if (!disclosure.expandable) return <></>;
  return (
    <Box sx={{ gridColumn: "1 / -1", minWidth: 0 }}>
      <Collapse in={disclosure.expanded} timeout={150}>
        <Box
          id={disclosure.regionId}
          role="region"
          sx={{
            minWidth: 0,
            // `padY`, not a fraction of the horizontal padding. The card's own
            // `py` wraps the summary AND the body, so once the body is in flow
            // the summary has no bottom padding of its own — at `comfortable`
            // the row visibly lost the height it had while closed.
            mt: padY,
            pt: padY,
            // A RULE BETWEEN SUMMARY AND BODY, bled through the row's horizontal
            // padding so it spans the card edge to edge. Inset, it reads as a
            // border around the content rather than a division of the card.
            borderTop: 1,
            borderColor: "divider",
            mx: -pad,
            px: pad,
          }}
        >
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}

export function BaseListCard(props: BaseListCardProps): React.JSX.Element {
  const { selected = false, onClick } = props;
  const shell = useRowShell(props);
  const { actionable, selectable, slot, drag, reserve, pad, padY, acts } = shell;
  const meta = metaShape(props);
  const disclosure = useDisclosure(props);
  const { cells, configured, cellTemplate } = useResolvedCells(props, shell.group != null);

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
      {drag.dropEdge != null && <DropIndicator edge={drag.dropEdge} />}
      <DiscloseSlot
        expandable={disclosure.expandable}
        expanded={disclosure.expanded}
        reserve={reserve}
        onToggle={disclosure.toggle}
        controls={disclosure.regionId}
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
      <RowContent card={props} cells={cells} configured={configured} slot={slot} actionable={actionable} meta={meta} />
      <ExpandableBody disclosure={disclosure} padY={padY} pad={pad}>
        {props.children}
      </ExpandableBody>
    </Card>
  );
}

export { META_BREAK, STACK_BREAK } from "./base-list-card-slots";
