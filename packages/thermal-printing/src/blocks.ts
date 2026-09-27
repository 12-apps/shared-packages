/**
 * The size-aware builders: sized text, a band, a box, a label/amount row, and
 * a picture.
 *
 * These take the PAPER WIDTH rather than a column count, unlike `field` and
 * `rule`. With one size there was one column count per roll and passing it
 * around was harmless. With four there are four, and asking the caller to pair
 * the right count with the right size is asking for a large line wrapped at the
 * medium count, which only shows up on paper. The builder knows the size, so it
 * looks the count up itself.
 *
 * Everything they build is plain text plus a flag, so ESC/POS and HTML render
 * the same characters in the same places: a row is padded here, a box is drawn
 * here, a band is centred here. The encoders only choose how.
 */
import type { LineEmphasis, RasterImage, TicketLine } from "./model";
import { columnsFor, type LineSize } from "./sizes";
import { padTo, textWidth, wrap } from "./wrap";

/** Size, weight and alignment of sized text. */
export interface TextStyle {
  /** Default `medium`. */
  size?: LineSize;
  bold?: boolean;
  /** Default `left`. */
  align?: "left" | "center";
  /** Hanging indent for the wrapped continuation, in columns of this size. */
  indent?: number;
}

/** Size and weight of a label/amount row. */
export interface RowStyle {
  /** Default `medium`. */
  size?: LineSize;
  bold?: boolean;
  /** Hanging indent for a wrapped label, in columns of this size. */
  indent?: number;
}

/** Size and weight of a band or a box. */
export interface FrameStyle {
  /** Default `medium`. */
  size?: LineSize;
  /** Default `true`: a band or a box is there to be noticed. */
  bold?: boolean;
}

const emphasisOf = (bold: boolean | undefined): LineEmphasis => (bold ? "bold" : "normal");

function sized(text: string, size: LineSize, bold: boolean | undefined): TicketLine {
  return { text, align: "left", emphasis: emphasisOf(bold), size };
}

/** `text` centred in `width` columns, padded on both sides. */
function centerIn(text: string, width: number): string {
  const used = textWidth(text);
  const left = Math.max(0, Math.floor((width - used) / 2));
  return " ".repeat(left) + text + " ".repeat(Math.max(0, width - used - left));
}

/**
 * Text in one of the four sizes, wrapped at that size's column count.
 *
 * An empty string yields one blank line of that size, so a spacer can be
 * written as `textLines("", width)` and still take up the height it names.
 */
export function textLines(text: string, paperWidthMm: number, style: TextStyle = {}): TicketLine[] {
  const size = style.size ?? "medium";
  const wrapped = wrap(text, columnsFor(paperWidthMm, size), style.indent ?? 0);
  return (wrapped.length > 0 ? wrapped : [""]).map((piece) => ({
    ...sized(piece, size, style.bold),
    align: style.align ?? "left",
  }));
}

/**
 * White on black, the full width of the roll: the line a reader has to see.
 *
 * Every line of it is padded to the full column count with the text centred,
 * because a reverse-printed space is a black cell — so the padding is what
 * carries the black from one edge of the paper to the other. A text too long
 * for one line wraps into a taller band, each line centred.
 */
export function band(text: string, paperWidthMm: number, style: FrameStyle = {}): TicketLine[] {
  const size = style.size ?? "medium";
  const columns = columnsFor(paperWidthMm, size);
  const wrapped = wrap(text, columns);
  return (wrapped.length > 0 ? wrapped : [""]).map((piece) => ({
    ...sized(centerIn(piece, columns), size, style.bold ?? true),
    frame: "band" as const,
  }));
}

/**
 * Text inside a drawn border, the full width of the roll.
 *
 * Drawn with box-drawing characters rather than asked of the printer: ESC/POS
 * has no rectangle command, and CP850 carries `┌─┐│└┘`, so the border prints
 * on every printer and renders identically in the HTML document. The text is
 * centred and wraps inside the border.
 */
export function box(text: string, paperWidthMm: number, style: FrameStyle = {}): TicketLine[] {
  const size = style.size ?? "medium";
  const columns = columnsFor(paperWidthMm, size);
  const inner = columns - 4;
  const bold = style.bold ?? true;
  const edge = "─".repeat(columns - 2);
  const wrapped = wrap(text, inner);
  const body = (wrapped.length > 0 ? wrapped : [""]).map((piece) => `│ ${centerIn(piece, inner)} │`);
  return [`┌${edge}┐`, ...body, `└${edge}┘`].map((piece) => ({
    ...sized(piece, size, bold),
    frame: "box" as const,
  }));
}

/**
 * A label on the left and an amount flush right: every money line.
 *
 * The amount sits on the FIRST line and the label wraps beside it, so the
 * right-hand column is read top to bottom as a list of amounts, each level with
 * the start of what it prices. When the amount is so long that the label would
 * get less than a third of the line, the label takes the full width and the
 * amount goes on a line of its own below it, still flush right.
 *
 * The amount is never split or cut. An amount wider than the whole line is
 * printed whole on its own line and runs past the edge — the printer wraps it
 * at its own column — because a truncated amount is a wrong amount, and a
 * wrong amount on a receipt is worse than an untidy one.
 */
export function row(
  label: string,
  amount: string,
  paperWidthMm: number,
  style: RowStyle = {},
): TicketLine[] {
  const size = style.size ?? "medium";
  const columns = columnsFor(paperWidthMm, size);
  const value = amount.normalize("NFC").trim();
  const amountWidth = textWidth(value);
  const labelWidth = columns - amountWidth - 1;
  const make = (text: string): TicketLine => sized(text, size, style.bold);
  if (labelWidth < Math.ceil(columns / 3)) {
    return [...wrap(label, columns, style.indent ?? 0), padTo(value, columns, "start")].map(make);
  }
  const [first = "", ...rest] = wrap(label, labelWidth, style.indent ?? 0);
  return [padTo(first, columns - amountWidth, "end") + value, ...rest].map(make);
}

/**
 * A picture on a line of its own.
 *
 * Centred by default, which is where a logo goes. The raster is taken as it is:
 * build it at the printer's dot size (see `printableDotsFor` and `./raster`),
 * since neither encoder rescales it.
 */
export function image(raster: RasterImage, align: "left" | "center" = "center"): TicketLine {
  return { text: "", align, emphasis: "normal", image: raster };
}
