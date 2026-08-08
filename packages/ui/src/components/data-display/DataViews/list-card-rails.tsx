"use client";

import { createContext, useContext, type ReactNode } from "react";

import { Box } from "../../../mui/Box";
import { DENSITY_ROW_PADDING, type DataViewsDensity } from "./data-views-layout-context";
import { CellConfigProvider, cellTracks, type ListCardCellConfig } from "./list-card-cells";

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
  /**
   * The disclosure chevron, ahead of everything.
   *
   * Reserved on the same terms as the gutters behind it: a list where only SOME
   * rows carry an expandable body would otherwise indent those rows and no
   * others, and a column of captions that starts at two different offsets reads
   * as a rendering fault rather than as a row you can open.
   */
  disclose: string;
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
  disclose: "auto",
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
  /**
   * How many tracks a row spans.
   *
   * Fixed at {@link RAIL_COUNT} for the named-slot layout, but a cell-configured
   * list has as many tracks as the config declares, and every row must span the
   * same number or subgrid tears.
   */
  railCount: number;
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
    rails.disclose,
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

/**
 * AN EMPTY GUTTER COSTS ITS OWN WIDTH *AND* THE RAIL GAP BESIDE IT.
 *
 * A zero-width grid track still gets a `column-gap`, and no margin on the item
 * inside it can win that back — gaps sit between TRACKS, and a track's position
 * is settled before any item's margin is applied. (Tried it; the box simply
 * overhangs its own track and everything after it stays put.) So a row with
 * nothing to drag was paying 24px for a rail holding nothing, which was the
 * single biggest contributor to the left inset the checkbox appeared to have.
 *
 * The only way out is for the track NOT TO EXIST: the slot renders nothing and
 * the rail leaves the template, which is safe because grid auto-placement fills
 * the remaining tracks in DOM order. Standalone only — inside a
 * {@link ListCardGroup} the rails are subgrid across a shared template and the
 * count cannot vary per row, which is also where `reserveGutters` earns its
 * keep: a selectable list and a read-only one still line up, and turning drag
 * mode on does not shift every row sideways.
 */
export function railsTemplateFor(
  gutters: { disclose: boolean; drag: boolean; select: boolean },
  metaColumns: number,
): string {
  return railsTemplate({
    ...DEFAULT_RAILS,
    // Standalone, the card can simply COUNT its pairs — no `metaColumns` to be
    // told, and no guess.
    ...contentRails(metaColumns),
    ...(gutters.disclose ? {} : { disclose: null }),
    ...(gutters.drag ? {} : { drag: null }),
    ...(gutters.select ? {} : { select: null }),
  });
}

/** How many rails the named-slot layout has — the span such a card claims. */
export const RAIL_COUNT = 9;

/**
 * The gutters and the trailing menu that bracket a CONFIGURED row.
 *
 * A cell-configured list still has a head and a tail the config does not
 * describe: the disclosure chevron, the drag grip and the checkbox in front, and
 * the overflow menu behind. The menu is not optional — it is where a row's
 * actions live, and a list that hid it would have nowhere to put them.
 */
const CELL_FIXED_RAILS = 4;

/** Tracks for a cell-configured row: gutters, leading, the cells, then the menu. */
export function cellRailsTemplate(cells: readonly string[]): string {
  return [
    DEFAULT_RAILS.disclose,
    DEFAULT_RAILS.drag,
    DEFAULT_RAILS.select,
    DEFAULT_RAILS.leading,
    ...cells,
    DEFAULT_RAILS.actions,
  ].join(" ");
}

/** How many tracks such a row spans — the fixed head/tail plus one per cell. */
export function cellRailCount(cells: number): number {
  return CELL_FIXED_RAILS + cells + 1;
}

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
  cells,
  metaColumns,
  rails,
  reserveGutters = true,
  gap,
  dataTestId,
}: {
  children: ReactNode;
  density?: DataViewsDensity;
  /**
   * The list's CELL CONFIG — declared once here, obeyed by every row.
   *
   * This is what makes the columns line up by construction rather than by
   * convention: the group resolves the tracks and hands the same config to every
   * card, so two rows cannot disagree about the shape of the list because
   * neither of them decides it.
   *
   * Supplying this replaces the named-slot layout (title/subtitle/meta/value/
   * status) for the rows inside — they render `row` through these cells instead.
   * The gutters and the overflow menu are unaffected; they bracket the cells and
   * are not the config's to describe.
   */
  cells?: readonly ListCardCellConfig<never>[];
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
  const configured = cells != null && cells.length > 0;
  const template = configured ? cellRailsTemplate(cellTracks(cells)) : railsTemplate(resolved);
  const railCount = configured ? cellRailCount(cells.length) : RAIL_COUNT;
  return (
    <ListRailsContext.Provider value={{ density, reserveGutters, railCount }}>
     <CellConfigProvider cells={cells}>
      <Box
        data-testid={dataTestId}
        sx={{
          // The query container for every row inside it — a row cannot be one
          // itself and a subgrid at the same time (containment drops subgrid).
          // Every row in a list is the same width anyway, so the group is the
          // honest place to ask the question.
          containerType: "inline-size",
          display: "grid",
          gridTemplateColumns: template,
          alignItems: "center",
          rowGap: gap ?? DENSITY_ROW_PADDING[density],
        }}
      >
        {children}
      </Box>
     </CellConfigProvider>
    </ListRailsContext.Provider>
  );
}
