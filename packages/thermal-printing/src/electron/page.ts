import { DOTS_PER_MM, PAPER_WIDTHS_MM, printableDotsFor } from "../sizes";

/**
 * The page a ticket is printed on: the ROLL, sized to the ticket.
 *
 * `webContents.print` with no `pageSize` does not mean "the printer's paper":
 * Electron fills in A4 (`options.pageSize ?? 'A4'` in its `web-contents.ts`),
 * and Chromium asks the driver for a 210 x 297 mm sheet. What a roll printer's
 * driver then does with an A4 page is up to the driver. A CUPS queue fits it
 * onto the roll, so a 72 mm ticket comes out 24.5 mm wide. A Bematech MP-4200
 * on Windows, sent the same A4 jobs, printed the ticket about 1.25 times too
 * large and cut off at the right edge (FUT-3009). So every print names its
 * page, and the page is the roll.
 *
 * Pure: the rendered body's size arrives as an argument (see `./measure`).
 */

/** What the offscreen window laid out, in millimetres. */
export interface RenderedBody {
  widthMm: number;
  heightMm: number;
}

/** A page in microns, which is the unit `webContents.print` takes. */
export interface PageSizeMicrons {
  width: number;
  height: number;
}

const MICRONS_PER_MM = 1000;

/**
 * How much wider than a roll's printable width a body may measure and still
 * count as fitting it. Layout rounds a 72 mm body to 71.97 mm. The slack
 * covers that rounding and nothing more, so a 58 mm roll's 48 mm is never
 * taken for enough to hold a 72 mm body.
 */
const FIT_SLACK_MM = 0.5;

/**
 * Paper added below the ticket. It covers a driver's unprintable top and
 * bottom margins, which the printable-area placement subtracts from the page.
 * Without it, the last line of a ticket spills onto a second page, and some
 * drivers cut between pages. On paper it is a centimetre of feed before the
 * cut.
 */
const TAIL_MM = 10;

/**
 * The narrowest roll whose printable width holds the rendered body.
 *
 * `./html` sets the body to exactly the printable width, so a 72 mm body is an
 * 80 mm ticket and a 48 mm body is a 58 mm one. A body wider than every roll
 * (a document from before FUT-2987) goes on the widest roll.
 */
export function rollFor(bodyWidthMm: number): number {
  const rolls = [...PAPER_WIDTHS_MM].sort((a, b) => a - b);
  const fits = rolls.find((roll) => printableDotsFor(roll) / DOTS_PER_MM + FIT_SLACK_MM >= bodyWidthMm);
  return fits ?? rolls[rolls.length - 1]!;
}

/**
 * The page for one ticket: the roll's full width, and the ticket's height plus
 * {@link TAIL_MM}.
 *
 * The page is never shorter than it is wide. A short ticket would otherwise be
 * a landscape sheet, and a driver may rotate a landscape sheet onto the roll.
 */
export function pageSizeFor(paperWidthMm: number, body: RenderedBody): PageSizeMicrons {
  const width = Math.round(paperWidthMm * MICRONS_PER_MM);
  const height = Math.ceil(body.heightMm + TAIL_MM) * MICRONS_PER_MM;
  return { width, height: Math.max(width, height) };
}
