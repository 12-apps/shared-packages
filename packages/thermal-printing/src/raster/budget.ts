/**
 * The limits on what one SVG may ask the rasteriser to do.
 *
 * The document is uploaded by whoever owns the artwork, so a length cap alone
 * bounds nothing that matters: a few hundred bytes can declare a canvas of
 * gigabytes, and a few kilobytes of repeated full-canvas shapes can keep a
 * thread busy for minutes. Each limit below is generous for a receipt logo and
 * small next to what the host has, and exceeding one REFUSES the document —
 * a reason in `unsupported`, no picture — rather than throwing or allocating.
 */

/** Widest raster: the printable width of an 80 mm roll. */
export const MAX_RASTER_WIDTH = 576;

/** Tallest raster: 2048 dots is 256 mm of paper — no logo is that tall. */
export const MAX_RASTER_HEIGHT = 2048;

/** Filled shapes per document. A one-plate mark has a handful; a detailed logo, hundreds. */
export const MAX_SHAPES = 4096;

/** Polygon vertices per document, after curves are flattened to about a dot per segment. */
export const MAX_PATH_POINTS = 250_000;

/**
 * Units of scan-conversion work per document: one per edge considered and one
 * per pixel touched, on every sub-row of every shape. A full-width 576 × 2048
 * logo built from a few dozen shapes spends a few million.
 */
export const MAX_FILL_WORK = 20_000_000;

/** Thrown inside the rasteriser when a budget runs out; caught by `rasterizeSvg`. */
export class BudgetExceeded extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** One document's remaining allowance. */
export class Budget {
  private shapes = 0;
  private points = 0;
  private work = 0;

  shape(): void {
    this.shapes += 1;
    if (this.shapes > MAX_SHAPES) throw new BudgetExceeded("too many shapes");
  }

  addPoints(count: number): void {
    this.points += count;
    if (this.points > MAX_PATH_POINTS) throw new BudgetExceeded("too many path points");
  }

  spend(units: number): void {
    this.work += units;
    if (this.work > MAX_FILL_WORK) throw new BudgetExceeded("too complex to fill");
  }
}
