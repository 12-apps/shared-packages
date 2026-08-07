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
  /** The one column that absorbs spare width. */
  caption: string;
  meta: string;
  /** The value's own rail, with a fixed right edge. */
  value: string;
  /** Wide enough for the longest status this list holds. */
  status: string;
  actions: string;
}

const DEFAULT_RAILS: ListRails = {
  drag: "auto",
  select: "auto",
  leading: "auto",
  caption: "minmax(0, 1fr)",
  meta: "auto",
  // `max-content` on the value, so the rail is as wide as the widest amount in
  // the list and no wider — a fixed px guess is either clipping or dead space.
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

/** The column template, as one `grid-template-columns` value. */
export function railsTemplate(rails: ListRails): string {
  return [
    rails.drag,
    rails.select,
    rails.leading,
    rails.caption,
    rails.meta,
    rails.value,
    rails.status,
    rails.actions,
  ].join(" ");
}

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
  rails,
  reserveGutters = true,
  gap,
  dataTestId,
}: {
  children: ReactNode;
  density?: DataViewsDensity;
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
  const resolved = { ...DEFAULT_RAILS, ...rails };
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
