/**
 * A QR sticker, as artwork a print shop can run.
 *
 * ## What this is for
 *
 * Somewhere in every host there is a URL that wants to live on a physical
 * object: a table's plaquinha, a fridge door, a shelf edge, a parcel. The
 * browser can draw that code on screen, and `window.print()` will then print
 * the browser's idea of the page — chrome, sidebar and all — at whatever size
 * the paper happens to be.
 *
 * This produces the other thing: one document, every sticker, vector, in
 * millimetres, with the boxes and marks a gráfica reads.
 *
 * ## It prints a URL, not a table
 *
 * Every word on the sticker arrives as data — the label, the line telling a
 * reader what to do with it, and the optional price. A builder that knew about
 * any one caller's domain would need a second copy of the bleed, the marks and
 * the quiet zone to print anything else, and those are exactly the parts nobody
 * can check on screen.
 *
 * For the same reason this module holds **no copy**. {@link STICKER_SIZES} is
 * dimensions and stable ids; what a size is CALLED is the host's, in the
 * host's languages.
 *
 * ## The decisions that matter to whoever runs the job
 *
 * - **`TrimBox` and `BleedBox` are declared**, not implied by a drawn frame.
 *   That is how a RIP knows where the blade goes; artwork that only *looks*
 *   trimmed gets imposed by eye.
 * - **3mm bleed**, with the sticker's background running into it, so a blade
 *   that lands a hair off does not leave a white lip.
 * - **Crop marks live outside the bleed**, never over the artwork.
 * - **The black is K only** (see `FILL_BLACK`). Rich black is four plates, and
 *   any misregistration fringes every edge of a code whose whole job is to be
 *   read by a phone camera in bad light.
 * - **Error correction H** — the highest. A sticker gets scratched, splashed
 *   and half-covered. H tolerates ~30% loss; a typical on-screen M tolerates 15%.
 * - **A quiet zone of 4 modules**, drawn explicitly. A QR with its margin
 *   trimmed off is the single most common way a printed code stops scanning,
 *   and it is invisible on screen because the browser gives it one for free.
 * - **The composition is balanced and scales with the sticker** — see
 *   `./stack`, which solves where every line goes. This module only draws what
 *   that one decided.
 */
import qrcode from "qrcode-generator";

import { FILL_BLACK, buildPdf, mm, rect, text } from "./pdf-doc";
import { individualPages, sheetPages } from "./layout";
import { LEADING, solveStack, typeMetrics } from "./stack";

/** What one sticker says. */
export interface QrSticker {
  /** The name of the thing the code points at. */
  label: string;
  /** The full URL the code carries. */
  url: string;
  /**
   * The line under the label, in the reader's language.
   *
   * Per sticker rather than per document because it is the sentence that says
   * what this particular code DOES — "ver o cardápio" on a table, "pagar pelo
   * celular" on a fridge — and a caller printing a mixed run would otherwise
   * have to pick one of them for all of it.
   */
  hint: string;
  /**
   * An optional price, already formatted in the host's currency and locale.
   *
   * A shelf label without a price is not a shelf label; a table's plaquinha
   * with one is wrong. So it is per sticker and optional, and the host decides
   * — including the part this module cannot know, which is that a price change
   * means a reprint.
   *
   * Formatted, never a number: currency and its placement are locale facts
   * this module has no business deciding.
   */
  priceLine?: string;
}

/** A trimmed sticker's final size, in millimetres. */
export interface StickerSize {
  widthMm: number;
  heightMm: number;
}

/**
 * The common sizes, as dimensions and stable ids.
 *
 * No labels: what a size is called is host copy, in the host's languages, and
 * a package that shipped one language's names would either force it on every
 * caller or need a locale resolver to print a rectangle.
 */
export const STICKER_SIZES: Readonly<Record<string, StickerSize>> = Object.freeze({
  small: { widthMm: 50, heightMm: 70 },
  medium: { widthMm: 70, heightMm: 100 },
  tent: { widthMm: 100, heightMm: 150 },
});

/** The QR's own margin, in modules. Four is the spec's minimum. */
const QUIET = 4;

/**
 * The dark modules of `url`, as rows of booleans.
 *
 * Level H, and the type number left at 0 so the encoder picks the smallest
 * version that fits — a shorter URL then prints fatter modules, which is
 * exactly the trade you want on something read at arm's length.
 */
function matrixFor(url: string): boolean[][] {
  const code = qrcode(0, "H");
  code.addData(url);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.isDark(row, col)),
  );
}

/**
 * The code as filled rectangles, merging each row's runs of dark modules.
 *
 * One rect per module would work and would also be the slow, fragile version:
 * adjacent fills can leave hairline seams where a RIP rounds two edges apart,
 * and a 45-module code is 2,000 operators per sticker. Merging horizontal runs
 * removes both problems and cuts the file by roughly a third.
 */
function qrOps(matrix: boolean[][], x: number, y: number, side: number): string {
  const modules = matrix.length;
  const cell = side / (modules + QUIET * 2);
  const ops: string[] = [];
  matrix.forEach((row, rowIndex) => {
    let runStart = -1;
    for (let col = 0; col <= modules; col += 1) {
      const dark = col < modules && (row[col] ?? false);
      if (dark && runStart === -1) runStart = col;
      if (!dark && runStart !== -1) {
        // PDF's y grows upward; the matrix's rows go down from the top.
        const top = y + side - (QUIET + rowIndex) * cell;
        ops.push(
          rect(x + (QUIET + runStart) * cell, top - cell, (col - runStart) * cell, cell),
        );
        runStart = -1;
      }
    }
  });
  return ops.join("\n");
}

/**
 * Everything inside one sticker's trim, drawn at `(x, y)`.
 *
 * The QR takes whatever the type does not, rather than the QR getting a fixed
 * share. On a sticker, every millimetre given to the code is read range — the
 * type is only ever confirmation for someone who is already standing there.
 */
export function stickerOps(
  sticker: QrSticker,
  x: number,
  y: number,
  size: StickerSize,
  brandName: string,
): string {
  const width = mm(size.widthMm);
  const height = mm(size.heightMm);
  const pad = mm(size.widthMm * 0.07);
  const centre = x + width / 2;
  const inner = width - pad * 2;
  const type = typeMetrics(size, sticker, brandName, inner);
  const { label, url } = type;
  const stack = solveStack(sticker, x, y, { width, height, pad, inner }, type);

  return [
    FILL_BLACK,
    brandName
      ? text(brandName, centre, stack.brandBase, { size: type.brand, center: true })
      : "",
    qrOps(matrixFor(sticker.url), stack.qr.x, stack.qr.y, stack.qr.side),
    // Wrapped and shrunk to fit rather than centred and overflowing: a product
    // name has no length limit, and one that runs past the trim is cut off by
    // the blade rather than by us.
    ...label.lines.map((line, index) =>
      text(line, centre, stack.labelBase - index * label.size * LEADING, {
        font: "F2",
        size: label.size,
        center: true,
      }),
    ),
    // Bold, and the largest thing after the label: on a shelf this is what the
    // shopper is actually looking for.
    sticker.priceLine
      ? text(sticker.priceLine, centre, stack.priceBase, {
          font: "F2",
          size: type.price,
          center: true,
        })
      : "",
    text(sticker.hint, centre, stack.hintBase, { size: type.hint, center: true }),
    // The address in human type, set apart at the foot. A code that stops
    // scanning — a torn corner, a phone with no camera — is then still a URL
    // somebody can reach.
    ...url.lines.map((line, index) =>
      text(line, centre, stack.urlBase - index * url.size * LEADING, {
        size: url.size,
        center: true,
      }),
    ),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export type QrStickerLayout = "individual" | "sheet";

export interface QrStickerPdfInput {
  stickers: QrSticker[];
  size: StickerSize;
  layout: QrStickerLayout;
  /** Whose stickers these are — printed small above each code. `""` omits it. */
  brandName: string;
  /** What the file is, for a reader's title bar and a print shop's job list. */
  title: string;
  /** `D:YYYYMMDDHHmmSS`, supplied by the caller so this stays pure. */
  date: string;
  /** Stamped into the document so a reprint can be traced to what made it. */
  creator: string;
}

export function buildQrStickerPdf(input: QrStickerPdfInput): Uint8Array<ArrayBuffer> {
  const pages =
    input.layout === "sheet"
      ? sheetPages(input.stickers, input.size, input.brandName)
      : individualPages(input.stickers, input.size, input.brandName);
  return buildPdf(pages, {
    // A plain hyphen: Info-dictionary strings are PDFDocEncoding, not the
    // WinAnsi the page text uses, and readers disagree about the high range.
    title: input.brandName ? `${input.title} - ${input.brandName}` : input.title,
    creator: input.creator,
    date: input.date,
  });
}

/** `D:YYYYMMDDHHmmSS`, the only date format a PDF's Info dictionary takes. */
export function pdfDateOf(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `D:${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}
