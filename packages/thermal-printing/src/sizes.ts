/**
 * The four type sizes, and what each one costs in columns.
 *
 * A receipt layout needs more than one size: a small one for details nobody
 * reads first, a body size, a highlight for the one number that matters, and a
 * headline. ESC/POS has no point sizes. It has two built-in fonts and integer
 * magnification, so the sizes here are named steps, each pinned to one font and
 * one multiplier:
 *
 * | size     | font | magnification | cell (dots) | 58 mm | 80 mm |
 * |----------|------|---------------|-------------|-------|-------|
 * | `small`  | B    | 1 × 1         | 9 × 17      | 42    | 64    |
 * | `medium` | A    | 1 × 1         | 12 × 24     | 32    | 48    |
 * | `large`  | B    | 2 × 2         | 18 × 34     | 21    | 32    |
 * | `xlarge` | A    | 2 × 2         | 24 × 48     | 16    | 24    |
 *
 * At 8 dots per millimetre a 24-dot cell is 3 mm tall, which is 8.5 pt; Font B
 * doubled is 34 dots, 12 pt; Font A doubled is 48 dots, 17 pt. Every one of the
 * four is reachable through `ESC !` alone — font select, double height, double
 * width — which is the part of the command set every printer in this class
 * implements, so no size depends on `GS !`.
 *
 * ## Why these two use double WIDTH when `double` never does
 *
 * The legacy `double` emphasis is double height only, because a line laid out
 * at 48 columns and then printed twice as wide silently rewraps at 24. That
 * danger is about a column count and a magnification disagreeing, not about
 * width as such. A sized line carries its size, and {@link columnsFor} answers
 * for that size, so the layout wraps at the count the printer will actually
 * use. Width and height are magnified together because a glyph that is only
 * taller reads as condensed, and a headline should read as a headline.
 */

/** The four steps, smallest first. */
export const LINE_SIZES = ["small", "medium", "large", "xlarge"] as const;

export type LineSize = (typeof LINE_SIZES)[number];

/** Which built-in font and which magnification a size prints in. */
export interface LineSizeMetrics {
  font: "A" | "B";
  multiplier: 1 | 2;
}

export const LINE_SIZE_METRICS: Readonly<Record<LineSize, LineSizeMetrics>> = {
  small: { font: "B", multiplier: 1 },
  medium: { font: "A", multiplier: 1 },
  large: { font: "B", multiplier: 2 },
  xlarge: { font: "A", multiplier: 2 },
};

/** Cell size of each built-in font, in dots, at magnification 1. */
export const FONT_CELL_DOTS: Readonly<Record<"A" | "B", { width: number; height: number }>> = {
  A: { width: 12, height: 24 },
  B: { width: 9, height: 17 },
};

/**
 * Print-head resolution: 203 dpi, which is 8 dots per millimetre, is what every
 * 58 and 80 mm printer in this class ships with.
 */
export const DOTS_PER_MM = 8;

/**
 * The two roll widths this class of printer ships for, in millimetres.
 *
 * Exported so a host can build its own validation (a schema, a database CHECK)
 * from the same source the column table uses, rather than restating 58 and 80
 * somewhere that can drift from it.
 */
export const PAPER_WIDTHS_MM = [58, 80] as const;

export type PaperWidthMm = (typeof PAPER_WIDTHS_MM)[number];

/**
 * The printable width in dots: 48 mm of a 58 mm roll (384 dots) and 72 mm of an
 * 80 mm one (576 dots). The rest is the margin the mechanism keeps.
 *
 * This is the width to rasterise an image at. Anything other than 58 answers
 * with the wider roll, the same fallback {@link columnsFor} uses.
 */
export function printableDotsFor(paperWidthMm: number): number {
  return paperWidthMm === 58 ? 48 * DOTS_PER_MM : 72 * DOTS_PER_MM;
}

/**
 * Columns a line holds, for a paper width and a size.
 *
 * With no size this is Font A — 32 columns on 58 mm, 48 on 80 mm — which is
 * what every line without a size prints in, including the legacy `double`.
 *
 * Anything other than 58 answers with the wider roll. That is a deliberate
 * fallback rather than a validation: a host that stored a third width before
 * adding support for it gets a ticket that is narrower than the paper, which
 * prints and can be read, instead of a throw on the way to the pass.
 */
export function columnsFor(paperWidthMm: number, size: LineSize = "medium"): number {
  const { font, multiplier } = LINE_SIZE_METRICS[size];
  return Math.floor(printableDotsFor(paperWidthMm) / (FONT_CELL_DOTS[font].width * multiplier));
}
