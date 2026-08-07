"use client";

import { createContext, useContext, type ReactNode } from "react";

import { Box } from "../../../mui/Box";
import { DENSITY_ROW_PADDING, type DataViewsDensity } from "./data-views-layout-context";

/**
 * THE LIST OWNS THE COLUMNS, NOT THE ROW.
 *
 * Every row laying itself out with flex produces a list where nothing lines up.
 * The caption takes `flex: 1` and shoves the rest right; the value sits after
 * the meta cluster with the same gap as any other pair, so `MÉTODO PIX
 * R$ 13,90` reads as one continuous run and the only unlabelled thing in the
 * row is the number that matters most; and because the status chip's width
 * varies with its text (`Pago` vs `Em aberto` vs `Cancelado`), the money jitters
 * left and right on every row down the page.
 *
 * So the rails are declared ONCE, here, and each card is `grid-template-columns:
 * subgrid` spanning them. One set of edges for the whole list, the value on its
 * own rail, the status in a slot wide enough for the longest label it will ever
 * hold. Adding a row cannot move the column.
 *
 * Subgrid needs the card to be a DIRECT child of this grid — no wrapper element
 * between them, which is why the group renders its children bare.
 */

/** One rail. Fixed where alignment matters, flexible where it does not. */
export interface ListRails {
  /** Reserved even when nothing drags: toggling drag mode must not shift the list. */
  drag: string;
  /** Reserved even when nothing is selectable, for the same reason. */
  select: string;
  leading: string;
  /** Absorbs spare width, alongside `meta`. */
  caption: string;
  /** Also absorbs spare width, so the middle columns spread rather than bunch. */
  meta: string;
  /** The value's own rail, with a fixed right edge. */
  value: string;
  /** Wide enough for the longest status this list holds. */
  status: string;
  actions: string;
}

/**
 * The meta rail, sized to sit its pairs on even intervals WITH the caption.
 *
 * ONE SHARE OF THE SPARE WIDTH PER PAIR, not one for the cluster. A single `1fr`
 * handed the whole cluster as much room as the title and then split it between
 * the pairs, so the title sat on a full share while `DATA` and `MÉTODO` had half
 * a share each — which is why the gap after the title came out twice the gap
 * between the pairs. Even columns need even shares, so the rail grows with the
 * number of pairs it has to hold.
 *
 * `max-content` still floors it: the evenness is never paid for with a clipped
 * label on a row too narrow to afford it.
 */
export function metaRail(columns: number): string {
  return `minmax(max-content, ${Math.max(columns, 1)}fr)`;
}

/**
 * The caption and meta rails, resolved TOGETHER — because exactly one of them
 * has to be the flexible track, and which one depends on whether the row has any
 * middle columns at all.
 *
 * A grid distributes its free space to `fr` tracks; with no `fr` present it
 * spreads it across every `auto` track instead — including the empty gutters,
 * the empty meta rail and the empty status rail. So a row with a title and a
 * value and nothing between them drifted its title into the middle of the row,
 * each empty rail having claimed an equal share of the slack.
 *
 * With pairs to place, `meta` is the flexible one and the caption sizes to its
 * title (the spare width belongs to the only rail with several things to space
 * out). With no pairs, there is nothing to distribute and the caption takes the
 * slack back, which is what it always did.
 */
export function contentRails(metaColumns: number): Pick<ListRails, "caption" | "meta"> {
  return metaColumns > 0
    ? { caption: "minmax(0, auto)", meta: metaRail(metaColumns) }
    : { caption: "minmax(0, 1fr)", meta: "auto" };
}

export const DEFAULT_RAILS: ListRails = {
  drag: "auto",
  select: "auto",
  leading: "auto",
  // Two is the canonical row (a date and a method); a list carrying a different
  // number says so with `metaColumns`, and a standalone card counts its own.
  ...contentRails(2),
  // `max-content` on the value, so the rail is as wide as the widest amount in
  // the list and no wider — a fixed px guess is either clipping or dead space.
  // NOT an `fr`: the value's whole promise is a fixed right edge, and a rail
  // that grows with the spare width moves that edge on every list.
  value: "max-content",
  status: "max-content",
  actions: "auto",
};

interface ListRailsValue {
  density: DataViewsDensity;
  /** Whether the gutters are held open even when empty. */
  reserveGutters: boolean;
}

const ListRailsContext = createContext<ListRailsValue | null>(null);

/** Is this card inside a group that owns the rails? */
export function useListRails(): ListRailsValue | null {
  return useContext(ListRailsContext);
}

/**
 * The column template, as one `grid-template-columns` value.
 *
 * A rail set to `null` is DROPPED rather than sized to zero. The two are not the
 * same: a zero-width track still takes a `column-gap` beside it, so a gutter
 * nobody is using still pushes the row's contents inward. Only a standalone card
 * may drop one — inside a group the rails are subgrid over a shared template and
 * every row must span the same count.
 */
export function railsTemplate(rails: RailOverrides): string {
  return [
    rails.drag,
    rails.select,
    rails.leading,
    rails.caption,
    rails.meta,
    rails.value,
    rails.status,
    rails.actions,
  ]
    .filter((rail): rail is string => rail != null)
    .join(" ");
}

/** A rail set, where `null` means "this rail is not in the template at all". */
type RailOverrides = { [K in keyof ListRails]: ListRails[K] | null };

/** The gap between rails, in theme spacing units. */
export const RAIL_GAP = 3;

/** …the same gap in pixels, for anything drawing INTO it. */
export const RAIL_GAP_PX = RAIL_GAP * 8;

/** How many rails there are — the span a card claims. */
export const RAIL_COUNT = 8;

/**
 * A list of {@link BaseListCard}s that share one set of columns.
 *
 * Also the natural home for the things a review pointed out belong to the list
 * rather than the card: the density every row answers, and — when it lands —
 * shift-click range selection and the single `aria-live` region a list needs
 * (fifty polite live regions is a screen-reader nightmare, which is why the
 * card no longer takes one).
 */
export function ListCardGroup({
  children,
  density = "cozy",
  metaColumns,
  rails,
  reserveGutters = true,
  gap,
  dataTestId,
}: {
  children: ReactNode;
  density?: DataViewsDensity;
  /**
   * How many labelled pairs the rows in this list carry.
   *
   * The rail claims one share of the spare width per pair, so the title and
   * every pair land on even intervals. A list is homogeneous — its rows show
   * the same fields — but the group renders its children opaquely and cannot
   * count them, so this is the one thing it has to be told.
   */
  metaColumns?: number;
  /** Override individual rails; anything omitted keeps its default. */
  rails?: Partial<ListRails>;
  /**
   * Hold the drag and select gutters open even when nothing uses them.
   *
   * On by default: a selectable list and a read-only one should line up, and
   * turning drag mode on should not shift every row sideways.
   */
  reserveGutters?: boolean;
  /** Row gap. Defaults to the density's own spacing. */
  gap?: number;
  dataTestId?: string;
}): React.JSX.Element {
  const resolved = {
    ...DEFAULT_RAILS,
    ...(metaColumns == null ? {} : contentRails(metaColumns)),
    ...rails,
  };
  return (
    <ListRailsContext.Provider value={{ density, reserveGutters }}>
      <Box
        data-testid={dataTestId}
        sx={{
          // The query container for every row inside it — a row cannot be one
          // itself and a subgrid at the same time (containment drops subgrid).
          // Every row in a list is the same width anyway, so the group is the
          // honest place to ask the question.
          containerType: "inline-size",
          display: "grid",
          gridTemplateColumns: railsTemplate(resolved),
          alignItems: "center",
          rowGap: gap ?? DENSITY_ROW_PADDING[density],
        }}
      >
        {children}
      </Box>
    </ListRailsContext.Provider>
  );
}
