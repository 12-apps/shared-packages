/**
 * A table that stops growing inside a dashboard block (FUT-3167).
 *
 * A ranking with sixty products drew sixty rows, so the block beside it ended
 * a screen and a half earlier and the canvas below was pushed out of reach:
 * the block was as tall as its longest list, not as tall as a dashboard tile
 * is worth. Inside a block the table now scrolls in place past about ten rows,
 * its header pinned so a figure is never read without its column, and the
 * block's "expand" tool opens the whole table in a dialog to be read properly.
 *
 * Only a dashboard block bounds its table. A report's own page, a block the
 * author gave a height (`Altura`), and the dialog itself all draw it whole.
 */

import type { Theme } from "@12-apps/ui/mui/styles";

/** About ten 36px rows under the 36px header. */
export const BOUNDED_TABLE_MAX_HEIGHT_PX = 400;

/**
 * `@12-apps/ui`'s `Table` renders inside a MUI `TableContainer`, which already
 * scrolls sideways; capping its height makes it scroll down too, in the same
 * box. The header cells take the paper colour because the report table's head
 * is transparent, and a pinned transparent header shows the rows sliding under
 * its labels.
 */
export const BOUNDED_TABLE_SX = {
  "& .MuiTableContainer-root": {
    maxHeight: `${BOUNDED_TABLE_MAX_HEIGHT_PX}px`,
    overflowY: "auto",
  },
  // The design system's table clips (`overflow: hidden`), and a clipping box
  // between a sticky cell and its scroller pins the cell to the CLIPPING box,
  // which never scrolls: the header scrolled away with the rows. The scroller
  // above already clips, so the table need not.
  "& .MuiTableContainer-root .MuiTable-root": { overflow: "visible" },
  "& .MuiTable-root .MuiTableHead-root .MuiTableCell-root": {
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: "background.paper",
    // The table collapses its borders, and a collapsed border stays with the
    // table, not with a stuck cell: scrolled, the rule under the header would
    // vanish. An inset shadow is the cell's own, so it travels with it.
    boxShadow: (theme: Theme) => `inset 0 -1px 0 ${theme.palette.divider}`,
  },
} as const;
