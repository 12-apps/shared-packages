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

/**
 * How loud a line is.
 *
 * `double` is double HEIGHT, never double width. Doubling the width halves the
 * usable columns, so a headline set that way silently rewraps at half the count
 * the layout just computed — a bug that only appears on paper, and only for the
 * longest names. Both encoders honour the same restriction for that reason.
 */
export type LineEmphasis = "normal" | "bold" | "double";

/** One printed line: what it reads, where it sits, how loud it is. */
export interface TicketLine {
  text: string;
  align: "left" | "center";
  emphasis: LineEmphasis;
}

/**
 * The two roll widths this class of printer ships for, in millimetres.
 *
 * Exported so a host can build its own validation (a schema, a database CHECK)
 * from the same source the column table uses, rather than restating 58 and 80
 * somewhere that can drift from it.
 */
export const PAPER_WIDTHS_MM = [58, 80] as const;

export type PaperWidthMm = (typeof PAPER_WIDTHS_MM)[number];

const COLUMNS_58 = 32;
const COLUMNS_80 = 48;

/**
 * Columns of Font A for a paper width.
 *
 * Anything other than 58 answers with the wider roll. That is a deliberate
 * fallback rather than a validation: a host that stored a third width before
 * adding support for it gets a ticket that is narrower than the paper, which
 * prints and can be read, instead of a throw on the way to the pass.
 */
export function columnsFor(paperWidthMm: number): number {
  return paperWidthMm === 58 ? COLUMNS_58 : COLUMNS_80;
}

/**
 * Break an over-long word into pieces the roll can hold.
 *
 * The printer would break it anyway, at a column this code did not choose — so
 * a 40-character product name is split here, where the layout can still put the
 * hanging indent in the right place.
 */
function chunk(word: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = word;
  while (rest.length > 0) {
    parts.push(rest.slice(0, limit));
    rest = rest.slice(limit);
  }
  return parts;
}

/** The text as words that each fit, so the wrapper below never has to break one. */
function fittingWords(text: string, limit: number): string[] {
  return text
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .flatMap((word) => (word.length <= limit ? [word] : chunk(word, limit)));
}

/**
 * Break text to the paper's width, indenting every line after the first.
 *
 * The hanging indent is what keeps a wrapped item readable as ONE thing:
 *
 * ```
 * 2x Chup Chup Gourmet - Maracuja com
 *    Nutella
 * ```
 *
 * reads as a single line of food at a glance, while a flush-left continuation
 * reads as a second item — which on a kitchen pass is a plate too many.
 */
export function wrap(text: string, columns: number, indent = 0): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const word of fittingWords(text, columns - indent)) {
    const current = lines[lines.length - 1];
    if (current === undefined) lines.push(word);
    else if (current.length + 1 + word.length > columns) lines.push(pad + word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  return lines;
}

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
