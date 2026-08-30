/**
 * `@12-apps/qr/pdf` — a URL, as artwork a print shop can run.
 *
 * The entry point is {@link buildQrStickerPdf}. Everything else exported here
 * is the small PDF writer underneath it, published because a host that wants a
 * different LAYOUT should compose these operators rather than fork the sticker
 * — the parts worth sharing are the ones nobody can check on screen (the boxes,
 * the bleed, the quiet zone, the K-only black), and those live in the builder
 * regardless of how the page is arranged.
 */
export {
  buildQrStickerPdf,
  pdfDateOf,
  STICKER_SIZES,
  type QrSticker,
  type QrStickerLayout,
  type QrStickerPdfInput,
  type StickerSize,
} from "./sticker";

export {
  FILL_BLACK,
  STROKE_BLACK,
  buildPdf,
  line,
  mm,
  num,
  rect,
  text,
  type PageBoxes,
  type PdfPage,
} from "./pdf-doc";
