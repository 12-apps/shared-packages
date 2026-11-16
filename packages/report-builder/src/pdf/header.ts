import type { TextStyle } from './canvas';
import { INK, INK_MUTED } from './theme';
import type { PdfPaintContext, ReportPdfBlock } from './types';

const TITLE: TextStyle = { size: 10.5, bold: true, color: INK };
const SENTENCE: TextStyle = { size: 7.5, color: INK_MUTED };
const SENTENCE_LINES = 2;
const GAP = 5;

interface BlockHeader {
  title: string | null;
  sentence: string[];
  height: number;
}

/** The block's title and the spec sentence under it, measured for `width`. */
export function headerFor(ctx: PdfPaintContext, block: ReportPdfBlock, width: number): BlockHeader {
  const title = block.title && block.title.trim() !== '' ? ctx.canvas.fit(block.title, TITLE, width) : null;
  const sentence = block.sentence ? ctx.canvas.wrap(block.sentence, SENTENCE, width, SENTENCE_LINES) : [];
  const height =
    (title ? TITLE.size * 1.3 : 0) + sentence.length * SENTENCE.size * 1.25 + (title || sentence.length ? GAP : 0);
  return { title, sentence, height };
}

export function drawHeader(ctx: PdfPaintContext, header: BlockHeader, x: number, top: number): void {
  let y = top;
  if (header.title) {
    ctx.canvas.text(header.title, x, y, TITLE);
    y += TITLE.size * 1.3;
  }
  for (const line of header.sentence) {
    ctx.canvas.text(line, x, y, SENTENCE);
    y += SENTENCE.size * 1.25;
  }
}
