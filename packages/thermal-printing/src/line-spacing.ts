/**
 * What one step of `ESC 3 n` is worth on a given printer.
 *
 * A framed line (a band or a box) closes the line spacing to the height of its
 * own cell, so the verticals of a box join and a band of several lines is one
 * black block. The cell height is counted in head DOTS (`FONT_CELL_DOTS`), and
 * on most printers in this class `ESC 3 n` counts dots too — Epson TM-T20,
 * Bematech MP-4200, Elgin i9 — so `n` is the cell height and the lines touch.
 *
 * Not on every printer. The Epson TM-T88 family counts `ESC 3 n` in its
 * vertical motion unit, 1/360 inch by default, under a 180-dpi head: one dot is
 * two units there, so the cell height sent as-is spaces each framed line at
 * half its cell and the lines overlap by about half a line. The fix is not a
 * different command — `GS P` would redefine the unit, and support for it is
 * unknown on the Bematech side — but the same command with `n` scaled to the
 * printer's own unit, which is a per-PRINTER fact a host has to store.
 *
 * Nothing on the wire tells the encoder which printer it is talking to, so
 * the unit is the host's to say, per printer. The default is the dot: a host
 * that says nothing gets exactly the bytes it always did. `./line-test` prints
 * the sheet that finds the unit from the paper.
 *
 * This fixes the VERTICAL half only. The TM-T88's 180-dpi head is also
 * narrower in dots (512 on 80 mm, 42 Font A columns where `columnsFor` answers
 * 48 for the 203-dpi class), unless the printer is set to its 48-column
 * emulation; the column count is out of this module's reach.
 */

/**
 * The units `ESC 3 n` is counted in, in the order the line-test sheet numbers
 * them (box 1 is the first, box 2 the second).
 *
 * - `dot` — one head dot. TM-T20, MP-4200, Elgin i9 and the rest of the 203-dpi
 *   class. The default.
 * - `inch-360` — 1/360 inch under a 180-dpi head, so two units per dot. The
 *   Epson TM-T88 family (every version).
 */
export const LINE_SPACING_UNITS = ["dot", "inch-360"] as const;

export type LineSpacingUnit = (typeof LINE_SPACING_UNITS)[number];

/** What a host that never says anything gets: today's bytes. */
export const DEFAULT_LINE_SPACING_UNIT: LineSpacingUnit = "dot";

/** Line-spacing units per head dot. */
const UNITS_PER_DOT: Readonly<Record<LineSpacingUnit, number>> = {
  dot: 1,
  "inch-360": 2,
};

/**
 * Whether `value` is a unit this version knows. A host validating a stored or
 * posted value uses this rather than restating the list.
 */
export function isLineSpacingUnit(value: unknown): value is LineSpacingUnit {
  return (LINE_SPACING_UNITS as readonly unknown[]).includes(value);
}

/**
 * `n` for `ESC 3 n`: a height in head dots, in the printer's unit.
 *
 * Never throws and never sends a byte the command cannot hold. A unit this
 * version does not know — a newer host's value, a typo in a stored row — is
 * read as the dot, the setting every printer in this class but one answers
 * correctly; the result is rounded and clamped to `0..255`.
 */
export function lineSpacingFor(heightDots: number, unit: LineSpacingUnit = DEFAULT_LINE_SPACING_UNIT): number {
  const perDot = UNITS_PER_DOT[isLineSpacingUnit(unit) ? unit : DEFAULT_LINE_SPACING_UNIT];
  const scaled = Math.round(heightDots * perDot);
  if (Number.isNaN(scaled)) return 0;
  return Math.min(255, Math.max(0, scaled));
}
