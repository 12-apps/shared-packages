/**
 * The line-test sheet: what lets somebody with no manual, and no idea what a
 * line-spacing unit is, find the one their printer uses. See `./line-spacing`
 * for why the unit varies.
 */
import { LINE_SPACING_UNITS, type LineSpacingUnit } from "./line-spacing";
import type { LineFrame, TicketLine } from "./model";
import { textWidth } from "./wrap";

/** One numbered section of the line-test sheet. */
export interface LineTestSection {
  /** The number printed in the box, and the one the person reads back: 1, 2, … */
  number: number;
  /** The unit this section's framed lines are spaced in. */
  unit: LineSpacingUnit;
  lines: TicketLine[];
}

/**
 * Columns of the sheet's box and band: 20 of Font A is 240 dots, inside the
 * printable width of every head in this class on either roll — the TM-T88's
 * 180-dpi head included (360 dots on 58 mm, 512 on 80 mm), whose own column
 * count `columnsFor` does not know. A sheet as wide as the roll would wrap on
 * the very printer it exists to identify, and a wrapped border reads as broken
 * whatever the spacing.
 */
const SHEET_COLUMNS = 20;

/**
 * The line-test sheet: the same box and band, once per unit, each numbered.
 *
 * Somebody who does not know the printer's model can still tell which of two
 * boxes came out with its lines touching and which with them overlapping or
 * apart, so the host prints this and asks "which box printed right?". The
 * answer is the section's {@link LineTestSection.unit}.
 *
 * Meaningful over ESC/POS only. The HTML encoder (a printer on a cable, a
 * preview) has no `ESC 3` to get wrong and draws both sections alike, so a host
 * offers the sheet only for a printer it drives with `./escpos`.
 *
 * Every framed line carries its section's unit in `lineSpacingUnit`, which the
 * ESC/POS encoder honours over its own option — that is what lets both units
 * print on one roll, in one job, through whatever pipeline already carries a
 * host's `TicketLine[]`. The host adds its own words around it (a heading, the
 * question) in its own language; the sheet itself carries only digits.
 *
 * Each section is a centred box three lines tall holding the number, above a
 * band two lines tall: a box shows the wrong unit as corners that overlap or
 * stand apart from the verticals, a band as its two lines overlapping or white
 * paper between them. Both are {@link SHEET_COLUMNS} wide on any roll.
 */
export function lineTestSheet(): LineTestSection[] {
  const inner = SHEET_COLUMNS - 4;
  const edge = "─".repeat(SHEET_COLUMNS - 2);
  return LINE_SPACING_UNITS.map((unit, index) => {
    const number = index + 1;
    const label = centerIn(String(number), inner);
    const framed = (text: string, frame: LineFrame): TicketLine => ({
      text,
      align: "center",
      emphasis: "bold",
      frame,
      lineSpacingUnit: unit,
    });
    const bandLine = framed(centerIn(String(number), SHEET_COLUMNS), "band");
    return {
      number,
      unit,
      lines: [
        framed(`┌${edge}┐`, "box"),
        framed(`│ ${label} │`, "box"),
        framed(`└${edge}┘`, "box"),
        bandLine,
        { ...bandLine },
        { text: "", align: "left", emphasis: "normal" },
      ],
    };
  });
}

/** `text` centred in `width` columns. */
function centerIn(text: string, width: number): string {
  const used = textWidth(text);
  const left = Math.max(0, Math.floor((width - used) / 2));
  return " ".repeat(left) + text + " ".repeat(Math.max(0, width - used - left));
}
