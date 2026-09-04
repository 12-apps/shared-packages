/**
 * How stickers are arranged on paper.
 *
 * Split from `sticker.ts` because it is a different job with a different
 * failure mode: that module decides what ONE sticker looks like, this one
 * decides where the blade goes and how many fit. A mistake here prints a mark
 * over the artwork or silently drops the thirteenth sticker; a mistake there
 * runs type off the edge.
 */
import { STROKE_BLACK, line, mm, num, type PdfPage } from "./pdf-doc";
import { stickerOps, type QrSticker, type StickerSize } from "./sticker";

const BLEED_MM = 3;
/** Room beyond the bleed for the marks to live in without touching artwork. */
const MARK_SPACE_MM = 5;
const MARK_LEN_MM = 4;

/** The four corner marks, drawn in the space outside the bleed. */
function cropMarks(trimX: number, trimY: number, width: number, height: number): string {
  const gap = mm(BLEED_MM);
  const len = mm(MARK_LEN_MM);
  const left = trimX;
  const right = trimX + width;
  const bottom = trimY;
  const top = trimY + height;
  const ops = [STROKE_BLACK, `${num(mm(0.15))} w`];
  // The four corners, listed rather than nested: two axes crossed by hand is
  // clearer here than a loop inside a loop, and there will never be a fifth.
  const corners: [number, number, number, number][] = [
    [left, -1, bottom, -1],
    [left, -1, top, 1],
    [right, 1, bottom, -1],
    [right, 1, top, 1],
  ];
  for (const [px, dx, py, dy] of corners) {
    // Horizontal arm, then vertical — both starting past the bleed so no mark
    // can ever print on the sticker itself.
    ops.push(line(px + dx * gap, py, px + dx * (gap + len), py));
    ops.push(line(px, py + dy * gap, px, py + dy * (gap + len)));
  }
  return ops.join("\n");
}

/** One page per sticker, at trim + bleed + marks — the handoff a gráfica wants. */
export function individualPages(
  stickers: QrSticker[],
  size: StickerSize,
  brandName: string,
): PdfPage[] {
  const margin = mm(BLEED_MM + MARK_SPACE_MM);
  const width = mm(size.widthMm);
  const height = mm(size.heightMm);
  const mediaW = width + margin * 2;
  const mediaH = height + margin * 2;
  const bleed = mm(BLEED_MM);
  return stickers.map((sticker) => ({
    boxes: {
      media: [0, 0, mediaW, mediaH],
      trim: [margin, margin, margin + width, margin + height],
      bleed: [margin - bleed, margin - bleed, margin + width + bleed, margin + height + bleed],
    },
    content: [
      cropMarks(margin, margin, width, height),
      stickerOps(sticker, margin, margin, size, brandName),
    ].join("\n"),
  }));
}

const A4 = { w: mm(210), h: mm(297) };

/** Between neighbours, and the narrowest margin the grid is allowed to leave. */
const GUTTER_MM = 4;
const MARGIN_MM = 10;

/** How many stickers fit across and down an A4 with a 10mm margin and 4mm gutter. */
function gridFor(size: StickerSize): { cols: number; rows: number } {
  const usableW = 210 - MARGIN_MM * 2;
  const usableH = 297 - MARGIN_MM * 2;
  return {
    cols: Math.max(1, Math.floor((usableW + GUTTER_MM) / (size.widthMm + GUTTER_MM))),
    rows: Math.max(1, Math.floor((usableH + GUTTER_MM) / (size.heightMm + GUTTER_MM))),
  };
}

/**
 * The same stickers imposed on A4 with cut guides — for printing in the
 * caller's own back office rather than sending the job out.
 *
 * Not the gráfica format and not pretending to be: no bleed (there is nowhere
 * for it to go between neighbours) and thin guides rather than corner marks.
 *
 * The grid is centred on the page, and centred on the FULL grid rather than on
 * however many stickers this particular page received. Both halves matter: it
 * used to hang from the top margin, which on the smallest preset left 10 mm
 * above and 69 mm of blank paper below; and a last page that re-centred on its
 * own two stickers would put its cut lines somewhere the other pages' are not,
 * which is exactly what stops a stack of sheets being guillotined in one pass.
 */
export function sheetPages(stickers: QrSticker[], size: StickerSize, brandName: string): PdfPage[] {
  const { cols, rows } = gridFor(size);
  const perPage = cols * rows;
  const width = mm(size.widthMm);
  const height = mm(size.heightMm);
  const gutter = mm(GUTTER_MM);
  const stepX = width + gutter;
  const stepY = height + gutter;
  const originX = (A4.w - (cols * stepX - gutter)) / 2;
  const originY = (A4.h + (rows * stepY - gutter)) / 2 - height;
  const pages: PdfPage[] = [];

  for (let start = 0; start < stickers.length; start += perPage) {
    const slice = stickers.slice(start, start + perPage);
    const ops = [STROKE_BLACK, `${num(mm(0.1))} w`];
    slice.forEach((sticker, index) => {
      const x = originX + (index % cols) * stepX;
      const y = originY - Math.floor(index / cols) * stepY;
      ops.push(
        `${num(x)} ${num(y)} ${num(width)} ${num(height)} re S`,
        stickerOps(sticker, x, y, size, brandName),
      );
    });
    pages.push({
      boxes: {
        media: [0, 0, A4.w, A4.h],
        trim: [0, 0, A4.w, A4.h],
        bleed: [0, 0, A4.w, A4.h],
      },
      content: ops.join("\n"),
    });
  }
  return pages;
}
