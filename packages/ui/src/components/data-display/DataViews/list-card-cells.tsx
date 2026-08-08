"use client";

import { createContext, useContext, type ReactNode } from "react";

import { Box } from "../../../mui/Box";

/**
 * THE CELL CONFIG — the list declares its columns once, every row obeys them.
 *
 * The row used to name its middle slots: a title, a subtitle beneath it, then
 * labelled `meta` pairs, then a value, then a status. That vocabulary was the
 * mistake twice over. It reads as a description of every list, and no list is
 * quite that shape — so a consumer wanting a date over a time, or an order
 * number over the client who placed it, had to pick whichever named slot was
 * least wrong and take its styling with it. And because each row decided its own
 * content, alignment across a list was a convention the rows could break.
 *
 * So cells are CONFIGURED, the way a data grid's columns are: the list declares
 * them once, and every card renders the same columns in the same tracks from its
 * own row. Two cards cannot disagree about the shape of the list, because
 * neither of them is deciding it.
 *
 * THE SECOND LINE IS AN OPTION, NOT A SUBTITLE. `secondary` is not "the small
 * grey text under the title" — it is the cell's second line, for whatever pairs
 * naturally in this list: date over time, name over e-mail, pedido over cliente.
 * It carries no meaning the config did not put there, and a cell that wants one
 * line simply omits it.
 */
export interface ListCardCellConfig<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable key. Also the cell's `data-slot`, so a test can find it by name. */
  id: string;
  /** The cell's first line, from the row. */
  primary: (row: T) => ReactNode;
  /** An optional second line beneath it. Anything that pairs with the first. */
  secondary?: (row: T) => ReactNode;
  /**
   * Which edge the lines sit on. `end` is what a column of numbers wants, so its
   * digits line up with the values above and below it — and it switches the cell
   * to tabular figures, since nothing else ever asks for that alignment.
   */
  align?: "start" | "center" | "end";
  /**
   * This cell's track, as a `grid-template-columns` entry. Defaults to an even
   * share of the spare width.
   *
   * A cell holding a number usually wants `max-content`: the rail is then as
   * wide as the widest amount in the list and no wider, and its right edge does
   * not move when a longer row arrives.
   */
  width?: string;
  /** Emphasise the first line — for the one figure the row is really about. */
  strong?: boolean;
}

const ALIGN_ITEMS = { start: "flex-start", center: "center", end: "flex-end" } as const;
const TEXT_ALIGN = { start: "left", center: "center", end: "right" } as const;

/** The default track: an even share of whatever width the row has spare. */
export const DEFAULT_CELL_WIDTH = "minmax(0, 1fr)";

/** The tracks a cell config asks for, in order. */
export function cellTracks(cells: readonly ListCardCellConfig<never>[] | undefined): string[] {
  return (cells ?? []).map((cell) => cell.width ?? DEFAULT_CELL_WIDTH);
}

/**
 * The config handed down by the list.
 *
 * A card inside a group takes its columns from here rather than from props, so
 * there is exactly one declaration of the list's shape and no way for a row to
 * hold a different one.
 */
const CellConfigContext = createContext<readonly ListCardCellConfig<never>[] | null>(null);

export function CellConfigProvider({
  cells,
  children,
}: {
  cells: readonly ListCardCellConfig<never>[] | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return <CellConfigContext.Provider value={cells ?? null}>{children}</CellConfigContext.Provider>;
}

/** The list's cell config, if it declared one. */
export function useCellConfig(): readonly ListCardCellConfig<never>[] | null {
  return useContext(CellConfigContext);
}

/**
 * One cell rendered from its config.
 *
 * Both lines truncate rather than wrap: a row is a fixed-height scanning unit,
 * and a cell that grows to two lines because one name was long drags every rail
 * on that row down with it. Whatever does not fit belongs in the expandable
 * body, which is the entire reason the body exists.
 */
function Cell<T extends Record<string, unknown>>({
  config,
  row,
}: {
  config: ListCardCellConfig<T>;
  row: T;
}): React.JSX.Element {
  const align = config.align ?? "start";
  const numeric = align === "end" ? { fontVariantNumeric: "tabular-nums" } : {};
  const clamp = {
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as const;
  const secondary = config.secondary?.(row);
  return (
    <Box
      data-slot={`cell-${config.id}`}
      sx={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: ALIGN_ITEMS[align],
        justifyContent: "center",
        textAlign: TEXT_ALIGN[align],
      }}
    >
      <Box
        component="span"
        sx={{ ...clamp, fontSize: 14, fontWeight: config.strong ? 700 : 600, lineHeight: 1.25, ...numeric }}
      >
        {config.primary(row)}
      </Box>
      {secondary != null && (
        <Box
          component="span"
          sx={{ ...clamp, fontSize: 12.5, lineHeight: 1.3, color: "text.secondary", ...numeric }}
        >
          {secondary}
        </Box>
      )}
    </Box>
  );
}

/** Every configured cell of a row, in the list's declared order. */
export function ListCardCells<T extends Record<string, unknown>>({
  cells,
  row,
}: {
  cells: readonly ListCardCellConfig<T>[];
  row: T;
}): React.JSX.Element {
  return (
    <>
      {cells.map((config) => (
        <Cell key={config.id} config={config} row={row} />
      ))}
    </>
  );
}
