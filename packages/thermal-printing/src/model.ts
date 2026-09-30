import type { LineSize } from "./sizes";

/**
 * How loud a line is.
 *
 * `double` is double HEIGHT, never double width. Doubling the width halves the
 * usable columns, so a headline set that way silently rewraps at half the count
 * the layout just computed — a bug that only appears on paper, and only for the
 * longest names. Both encoders honour the same restriction for that reason.
 *
 * On a line that carries a {@link TicketLine.size}, the size decides the font
 * and the magnification, and `bold` and `double` both mean only "bold weight".
 */
export type LineEmphasis = "normal" | "bold" | "double";

/**
 * A decoration that spans the line rather than sitting in its text.
 *
 * - `band` — white on black, the full width of the roll. The builder pads the
 *   text to the full column count, so the black runs edge to edge on paper.
 * - `box` — the text is already drawn with box-drawing characters (CP850 has
 *   them, so they print on every printer); the frame only tells the encoders to
 *   close the line spacing, so the verticals join into one border.
 */
export type LineFrame = "band" | "box";

/**
 * A 1-bit picture, in the printer's own raster format.
 *
 * `width` and `height` are in printer DOTS (8 per millimetre). `data` holds the
 * rows top to bottom, each `Math.ceil(width / 8)` bytes, most significant bit
 * leftmost, and a set bit is a black dot. That is byte for byte what `GS v 0`
 * takes, so the ESC/POS encoder copies it rather than converting it.
 *
 * Build one with `toMonochrome` / `rasterizeSvg` from `./raster`, or bring your
 * own. The width should not exceed `printableDotsFor(paperWidthMm)` — the
 * encoders take lines, not a paper width, so they cannot clip it for you.
 */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * One printed line: what it reads, where it sits, how loud it is.
 *
 * The three required fields are the original model and still mean what they
 * did. The optional ones are additive — a line without them prints exactly as
 * before, byte for byte.
 */
export interface TicketLine {
  text: string;
  align: "left" | "center";
  emphasis: LineEmphasis;
  /** One of the four type sizes. Absent: Font A at 1 × 1, or the legacy `double`. */
  size?: LineSize;
  /** A band or a box. See {@link LineFrame}. */
  frame?: LineFrame;
  /** A raster picture. When present the line prints the picture and not `text`. */
  image?: RasterImage;
}
