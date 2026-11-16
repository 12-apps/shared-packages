import type { TextStyle } from './canvas';
import type { PdfPaintContext, ReportPdfBlock } from './types';

const TITLE: TextStyle = { size: 10.5, bold: true, color: 'ink' };
const SENTENCE: TextStyle = { size: 7.5, color: 'muted' };
const TITLE_LINES = 2;
const SENTENCE_LINES = 2;
const GAP = 5;

interface BlockHeader {
  title: string[];
  sentence: string[];
  height: number;
}

/**
 * The block's title and the spec sentence under it, measured for `width`. A
 * title wraps to a second line before it is ever cut. A tile has no sentence:
 * its caption is the label inside the card, which is how the screen shows it.
 */
export function headerFor(
  ctx: PdfPaintContext,
  block: ReportPdfBlock,
  width: number,
  options: { sentence?: boolean } = {},
): BlockHeader {
  const title = block.title && block.title.trim() !== '' ? ctx.canvas.wrap(block.title, TITLE, width, TITLE_LINES) : [];
  const sentence =
    block.sentence && options.sentence !== false ? ctx.canvas.wrap(block.sentence, SENTENCE, width, SENTENCE_LINES) : [];
  const height =
    title.length * TITLE.size * 1.3 + sentence.length * SENTENCE.size * 1.25 + (title.length || sentence.length ? GAP : 0);
  return { title, sentence, height };
}

export function drawHeader(ctx: PdfPaintContext, header: BlockHeader, x: number, top: number): void {
  let y = top;
  for (const line of header.title) {
    ctx.canvas.text(line, x, y, TITLE);
    y += TITLE.size * 1.3;
  }
  for (const line of header.sentence) {
    ctx.canvas.text(line, x, y, SENTENCE);
    y += SENTENCE.size * 1.25;
  }
}
