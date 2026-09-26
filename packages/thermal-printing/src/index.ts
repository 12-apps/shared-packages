/**
 * A receipt ticket as fixed-width LINES — the document every transport shares.
 *
 * A thermal printer is a fixed-width device. It holds a column count (32 on a
 * 58mm roll, 48 on 80mm in Font A) and prints whatever arrives, so wrapping,
 * padding, indentation and divider widths are arithmetic that has to happen
 * somewhere. This module is that somewhere, and putting it in ONE place is what
 * lets a host promise something it otherwise cannot: that a store which swaps a
 * USB printer for a network one gets the same ticket rather than a second
 * layout maintained beside the first.
 *
 * So the shape of this package is a sandwich. The host composes a
 * `TicketLine[]` from the helpers here — it alone knows what its ticket says,
 * in which language, in which order. The encoders (`./escpos`, `./html`) take
 * those lines and only decide how a line becomes bytes or markup. Neither end
 * knows about the other.
 *
 * The second thing that buys is testability. A layout built from these helpers
 * is assertable line by line with no printer, no socket and no headless browser
 * anywhere near the test — which matters for a device class whose failure mode
 * is "the paper came out wrong" and whose feedback loop is a person in a shop.
 *
 * Everything here is pure and isomorphic: no clock, no I/O, no Node builtins.
 */

import type { LineEmphasis, TicketLine } from "./model";
import { wrap } from "./wrap";

export type { LineEmphasis, LineFrame, RasterImage, TicketLine } from "./model";
export { wrap } from "./wrap";
export {
  band,
  box,
  image,
  row,
  textLines,
  type FrameStyle,
  type RowStyle,
  type TextStyle,
} from "./blocks";
export {
  columnsFor,
  DOTS_PER_MM,
  FONT_CELL_DOTS,
  LINE_SIZE_METRICS,
  LINE_SIZES,
  PAPER_WIDTHS_MM,
  printableDotsFor,
  type LineSize,
  type LineSizeMetrics,
  type PaperWidthMm,
} from "./sizes";

/** A left-aligned line. */
export function line(text: string, emphasis: LineEmphasis = "normal"): TicketLine {
  return { text, align: "left", emphasis };
}

/** A centred line. */
export function centered(text: string, emphasis: LineEmphasis = "normal"): TicketLine {
  return { text, align: "center", emphasis };
}

/** A full-width divider. */
export function rule(columns: number): TicketLine {
  return { text: "-".repeat(columns), align: "left", emphasis: "normal" };
}

/**
 * `Label: value`, wrapped under a hanging indent, and dropped entirely when
 * there is no value.
 *
 * Dropping rather than printing an empty label is the point. A roll is a scarce
 * medium read at arm's length, and a column of headings with nothing after them
 * costs the lines the reader actually needs. The host passes the label already
 * translated; this only knows how wide it is.
 */
export function field(label: string, value: string | null, columns: number): TicketLine[] {
  if (value === null || value.trim().length === 0) return [];
  return wrap(`${label}: ${value}`, columns, label.length + 2).map((text) => line(text));
}
