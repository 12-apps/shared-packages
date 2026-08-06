"use client";

import { type ReactNode } from "react";



import { useTheme } from "@mui/material/styles";

import { Checkbox } from "../../form/Checkbox";
import { Card } from "../../layout/Card";
import { DescriptionItem, type DescriptionItemProps } from "../DescriptionItem";
import { DragHandle, useDragItem } from "./data-views-drag";
import { DENSITY_ROW_PADDING, type DataViewsDensity } from "./data-views-layout-context";
import {
  cardSurfaceStyles,
  isSelectable,
  surfaceScale,
  type CardSurfaceProps,
} from "./card-surface";
import { listCardSx, META_BREAK, STACK_BREAK } from "./base-list-card-style";
import { Box } from "../../../mui/Box";
import { Text } from "../../typography/Text";

/**
 * THE "LISTA" LAYOUT'S CARD — {@link BaseCard}'s horizontal sibling.
 *
 * `ListBody` has always described the shape it wanted ("a marker, a title, a
 * subtitle and a value on the right") and never provided it, so every host
 * hand-rolled a `<Box>` flex row. They all came out the same way: a background
 * tint for selection but no checkbox, so a single row could not be selected at
 * all; hard-coded `minWidth` columns that ignore density and never collapse; no
 * hover, no click target, no focus ring, where the table rows have all three.
 *
 * RESPONDS TO ITS OWN WIDTH, NOT THE VIEWPORT. The collapse below is a CSS
 * container query, for the same reason the toolbar measures instead of
 * breakpointing: this card renders full-bleed on a phone, inside a 300px board
 * column, and beside a filter panel that opens and closes — three different
 * widths at one viewport size. A media query is wrong for at least two of them.
 */

export interface BaseListCardProps extends CardSurfaceProps {
  /** A marker: avatar, thumbnail or icon, pinned to the start of the row. */
  leading?: ReactNode;
  /** First-class title. */
  title?: ReactNode;
  /** Secondary line under the title. */
  subtitle?: ReactNode;
  /**
   * Middle columns — a date, a customer, a count — as labelled pairs.
   *
   * {@link DescriptionItem}s, not free-form nodes: the hand-rolled rows put
   * bare values in a line of fixed-width boxes, so `05/08/2026, 13:45` and
   * `R$ 8,90` sat side by side with nothing saying which was which, and a
   * screen reader read the row as four unrelated strings. A label per value
   * fixes both, and gives every list in the app the same pair styling.
   *
   * Rendered `horizontal` by default (label beside value, which is what fits a
   * row); pass `orientation` per item to stack one.
   *
   * The FIRST thing dropped when the row runs out of room — the only slot whose
   * absence does not stop the row being identified or acted on.
   */
  meta?: DescriptionItemProps[];
  /** Escape hatch for a middle section these pairs cannot express. */
  metaSlot?: ReactNode;
  /** The number this row is really about, right-aligned and never truncated. */
  value?: ReactNode;
  /** A status chip or badge, after the value. */
  status?: ReactNode;
  /**
   * INLINE actions — the one or two things done to this row often enough to
   * deserve a button of their own ("Ver", "Imprimir").
   *
   * Separate from {@link menu} rather than folded into it because they answer
   * different questions: this is "what do I do with this row", the menu is
   * "what else". Both stop propagation, so neither can fire the row's own
   * `onClick` by accident — the bug every hand-rolled row shipped with.
   *
   * They are the FIRST thing to move into the menu when the host knows the row
   * will be narrow; this card does not do it automatically, because which
   * action is worth a button is a decision only the host can make.
   */
  actions?: ReactNode;
  /** The 3-dots overflow menu, pinned to the end. */
  menu?: ReactNode;
  /** Extra content below the main row (chips, a progress bar, a nested list). */
  children?: ReactNode;
  /** Toggle this row's selection. Omit to hide the checkbox (non-selectable). */
  onToggleSelect?: () => void;
  /**
   * How much air the row gets — the SAME three values the Exibição panel
   * offers, so a list answers the operator's density preference directly
   * instead of the host translating it into a number.
   *
   * It drives the vertical padding, which is what density means on a full-width
   * row: the row cannot get narrower, so height is the only thing left to
   * spend. Defaults to `cozy`.
   */
  density?: DataViewsDensity;
  /**
   * Padding multiplier, 1 = base — the same knob {@link BaseCard} takes, so a
   * list and a grade of the same records scale in step.
   *
   * Orthogonal to `density`: this is how big everything is, density is how
   * tightly the rows stack. Both apply.
   */
  scale?: number;
  /**
   * Flush list style: a bottom rule instead of an outline — a row-only
   * variant, which is why it is a flag here rather than a `CardSurfaceVariant`
   * a tile would have no use for.
   *
   * `ListBody` stacks these with a density gap between them, and a bottom rule
   * floating in that gap belongs to neither row, so the default stays outlined.
   * Pass this only when the host draws its own gapless list.
   */
  divider?: boolean;
  /**
   * This row's id for drag purposes.
   *
   * Draggable ONLY when a {@link DragContainerProvider} is above it — see
   * `data-views-drag`. Outside one, this is inert and no handle appears: a card
   * cannot know whether the thing holding it reorders, and a grip that does
   * nothing is worse than no grip.
   */
  dragId?: string | number;
  checkboxTestId?: string;
}

/** Title over subtitle, both ellipsised — the block that absorbs spare width. */
function ListCardCaption({
  title,
  subtitle,
  scale,
}: Pick<BaseListCardProps, "title" | "subtitle"> & { scale: number }): React.JSX.Element {
  const clamp = {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as const;
  return (
    // minWidth:0 is what lets the ellipsis happen at all: a flex child defaults
    // to min-width:auto and refuses to shrink below its content.
    <Box sx={{ flex: 1, minWidth: 0 }}>
      {title != null && (
        <Text
          variant="heading"
          size="sm"
          weight="bold"
          as="p"
          style={{ lineHeight: 1.2, fontSize: `${0.9 * scale}rem`, ...clamp }}
        >
          {title}
        </Text>
      )}
      {subtitle != null && (
        <Text variant="caption" size="xs" color="secondary" as="p">
          <Box component="span" sx={{ display: "block", ...clamp }}>
            {subtitle}
          </Box>
        </Text>
      )}
    </Box>
  );
}

/** The right-hand cluster: the value, its status, and the menu. */
function ListCardTail({
  value,
  status,
  actions,
  menu,
  scale,
}: Pick<BaseListCardProps, "value" | "status" | "actions" | "menu"> & {
  scale: number;
}): React.JSX.Element | null {
  if (value == null && status == null && actions == null && menu == null) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        // Never squeezed and never truncated: the amount is the one thing on
        // this row nobody can infer from the rest of it.
        flexShrink: 0,
        [`@container (max-width: ${STACK_BREAK}px)`]: { width: "100%", justifyContent: "flex-start" },
      }}
    >
      {value != null && (
        <Text variant="body" size="sm" weight="medium" as="span">
          <Box component="span" sx={{ fontSize: `${0.875 * scale}rem`, whiteSpace: "nowrap" }}>
            {value}
          </Box>
        </Text>
      )}
      {status}
      {/* Acting on an action or the menu must never trigger the row's own
          click — the bug every hand-rolled row shipped with. */}
      {actions && (
        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
          onClick={(event) => event.stopPropagation()}
        >
          {actions}
        </Box>
      )}
      {menu && <Box onClick={(event) => event.stopPropagation()}>{menu}</Box>}
    </Box>
  );
}

/**
 * The middle columns as labelled pairs, dropped first when the row runs out of
 * room. `horizontal` unless the item asks otherwise — a row has width to spare
 * and height it does not.
 */
function ListCardMeta({
  meta,
  metaSlot,
}: Pick<BaseListCardProps, "meta" | "metaSlot">): React.JSX.Element | null {
  const items = meta ?? [];
  if (items.length === 0 && metaSlot == null) return null;
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexShrink: 0,
        whiteSpace: "nowrap",
        [`@container (max-width: ${META_BREAK}px)`]: { display: "none" },
      }}
    >
      {items.map((item, index) => (
        <DescriptionItem
          key={`${item.label}-${index}`}
          orientation="horizontal"
          {...item}
        />
      ))}
      {metaSlot}
    </Box>
  );
}

/** The select checkbox, at the start of the row rather than floating over it. */
function ListCardCheckbox({
  selected,
  onToggleSelect,
  checkboxTestId,
}: Pick<BaseListCardProps, "selected" | "onToggleSelect" | "checkboxTestId">): React.JSX.Element | null {
  if (!onToggleSelect) return null;
  return (
    <Checkbox
      checked={selected}
      onChange={() => onToggleSelect()}
      // Selecting must never trigger the row's own click (open/edit).
      onClick={(event) => event.stopPropagation()}
      size="small"
      data-testid={checkboxTestId}
      aria-label="Selecionar"
    />
  );
}

/** The single line of slots, in the order the eye reads them. */
function ListCardRow({
  scale,
  selected,
  selectable,
  drag,
  ...props
}: BaseListCardProps & {
  scale: number;
  selected: boolean;
  selectable: boolean;
  drag: ReturnType<typeof useDragItem>;
}): React.JSX.Element {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        minWidth: 0,
        // Wrapping is the LAST rung: below `STACK_BREAK` the tail drops to its
        // own line instead of squeezing the title into two characters.
        flexWrap: "nowrap",
        [`@container (max-width: ${STACK_BREAK}px)`]: { flexWrap: "wrap", rowGap: 1 },
      }}
    >
      {/* The grip goes FIRST, before the checkbox: it is where the hand reaches,
          and a handle after the checkbox means every drag starts with a
          near-miss on a control that toggles selection. */}
      {drag.draggable && (
        <DragHandle
          handleProps={drag.handleProps}
          gated={drag.handleProps !== undefined}
          testId={props.dataTestId ? `${props.dataTestId}-drag` : undefined}
        />
      )}
      <ListCardCheckbox
        selected={selected}
        onToggleSelect={selectable ? props.onToggleSelect ?? (() => {}) : undefined}
        checkboxTestId={props.checkboxTestId}
      />
      {props.leading != null && (
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>{props.leading}</Box>
      )}
      <ListCardCaption title={props.title} subtitle={props.subtitle} scale={scale} />
      <ListCardMeta meta={props.meta} metaSlot={props.metaSlot} />
      <ListCardTail
        value={props.value}
        status={props.status}
        actions={props.actions}
        menu={props.menu}
        scale={scale}
      />
    </Box>
  );
}

/**
 * A selectable full-width row for the DataViews "Lista" layout: a marker, a
 * title over a subtitle, middle columns, a value, a status and a menu.
 *
 * Reads no context, so it renders standalone as well as inside the grid — and
 * like {@link BaseCard} it is a SHELL. Domain rows (pedido, mesa, produto) live
 * in the app and compose this envelope rather than re-deriving the layout.
 */
export function BaseListCard(props: BaseListCardProps): React.JSX.Element {
  const { selected = false, divider = false, density = "cozy", onClick, dataTestId } = props;
  const selectable = isSelectable(props);
  const theme = useTheme();
  const scale = surfaceScale(props.size, props.scale);
  const drag = useDragItem(props.draggable === false ? undefined : props.dragId);
  const pad = 1.5 * scale;
  // Vertical only. A full-width row cannot get narrower, so height is the one
  // thing density has left to spend — and the horizontal padding still has to
  // line the row's contents up with the toolbar above it at every setting.
  const padY = DENSITY_ROW_PADDING[density] * scale;

  return (
    <Card
      variant="outlined"
      borderRadius="lg"
      onClick={onClick}
      dataTestId={dataTestId}
      className={props.className}
      aria-label={props["aria-label"]}
      aria-live={props["aria-live"]}
      aria-atomic={props["aria-atomic"]}
      {...drag.itemProps}
      // A PLAIN OBJECT, not a function. `Card` merges by spreading
      // (`sx={{ ...defaults, ...sx }}`), and spreading a function yields
      // nothing at all — the styles vanish silently, which is exactly how the
      // first version of this shipped with no variants and no effects.
      sx={{
        // The shared half — variant, colour, selection, effects — so a Grade and
        // a Lista of the same records are dressed by one set of rules…
        ...cardSurfaceStyles({
          ...props,
          selectable,
          // A row mid-drag is a ghost of itself; the drop target is what the eye
          // should be on.
          dimmed: props.dimmed === true || drag.dragging,
        }, theme),
        // …and the row's own geometry on top, so `divider` still wins over the
        // outline it replaces.
        ...listCardSx({
          pad,
          padY,
          interactive: onClick != null,
          divider,
          draggable: drag.draggable && drag.handleProps === undefined,
        }),
      }}
    >
      <ListCardRow
        {...props}
        scale={scale}
        selected={selected}
        selectable={selectable}
        drag={drag}
      />
      {props.children != null && <Box sx={{ mt: pad * 0.5, minWidth: 0 }}>{props.children}</Box>}
    </Card>
  );
}
