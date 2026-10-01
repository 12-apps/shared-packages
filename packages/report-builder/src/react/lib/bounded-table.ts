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
  "& .MuiTable-root .MuiTableHead-root .MuiTableCell-root": {
    position: "sticky",
    top: 0,
    zIndex: 1,
    backgroundColor: "background.paper",
  },
} as const;
