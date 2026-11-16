import { PDFDocument, StandardFonts, type Color, type PDFFont, type PDFPage } from 'pdf-lib';

import { ReportPdfError } from './errors';
import { INK } from './theme';

/** A4, in points. */
export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
export const MARGIN_X = 40;
const MARGIN_TOP = 40;
const MARGIN_BOTTOM = 52;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

/** Where a baseline sits inside a line box, as a share of the font size. */
const ASCENT = 0.78;
const ELLIPSIS = '\u2026';

interface PdfLimits {
  maxPages: number;
  timeoutMs: number;
}

export interface TextStyle {
  size: number;
  bold?: boolean;
  color?: Color;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * The drawing surface: pages, a cursor that moves DOWN the page, and text that
 * can be measured before it is drawn.
 *
 * Every coordinate a caller passes is measured from the TOP-LEFT of the page,
 * because layout thinks downwards; the conversion to PDF's bottom-left origin
 * is done here, once. The standard Helvetica faces are used on purpose: every
 * PDF reader carries them, so nothing is fetched and no font file is embedded,
 * and the bytes depend on nothing but the input.
 */
export class PdfCanvas {
  readonly doc: PDFDocument;
  readonly fonts: Fonts;
  private readonly pages: PDFPage[] = [];
  private readonly encodable: { regular: Set<number>; bold: Set<number> };
  private readonly started: number;
  cursor = MARGIN_TOP;

  constructor(
    doc: PDFDocument,
    fonts: Fonts,
    private readonly limits: PdfLimits,
    private readonly clock: () => number,
  ) {
    this.doc = doc;
    this.fonts = fonts;
    this.encodable = {
      regular: new Set(fonts.regular.getCharacterSet()),
      bold: new Set(fonts.bold.getCharacterSet()),
    };
    this.started = clock();
    this.newPage();
  }

  static async create(limits: PdfLimits, clock: () => number): Promise<PdfCanvas> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    const fonts = {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
    return new PdfCanvas(doc, fonts, limits, clock);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get page(): PDFPage {
    const current = this.pages[this.pages.length - 1];
    if (!current) throw new Error('The document has no page.');
    return current;
  }

  pageAt(index: number): PDFPage {
    const found = this.pages[index];
    if (!found) throw new Error(`The document has no page ${index + 1}.`);
    return found;
  }

  /** Fail fast once the render budget is spent; called between units of work. */
  tick(): void {
    if (this.clock() - this.started > this.limits.timeoutMs) {
      throw new ReportPdfError('timeout', `The report PDF took longer than ${this.limits.timeoutMs} ms.`);
    }
  }

  canAddPage(): boolean {
    return this.pages.length < this.limits.maxPages;
  }

  newPage(): void {
    if (!this.canAddPage()) {
      throw new ReportPdfError('too_large', `The report PDF needs more than ${this.limits.maxPages} pages.`, {
        pageCount: this.pages.length + 1,
      });
    }
    this.pages.push(this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]));
    this.cursor = MARGIN_TOP;
  }

  get remaining(): number {
    return PAGE_HEIGHT - MARGIN_BOTTOM - this.cursor;
  }

  /** Start a new page unless `height` fits under the cursor (or the page is fresh). */
  ensure(height: number): void {
    if (height > this.remaining && this.cursor > MARGIN_TOP) this.newPage();
  }

  /** The text as the standard font can write it: no control characters, no unknown glyph. */
  clean(text: string, bold = false): string {
    const set = bold ? this.encodable.bold : this.encodable.regular;
    let out = '';
    for (const char of text.replace(/[\u00a0\u202f\u2007]/g, ' ').replace(/[\r\n\t]+/g, ' ')) {
      const code = char.codePointAt(0) ?? 63;
      out += set.has(code) ? char : '?';
    }
    return out;
  }

  private font(style: TextStyle): PDFFont {
    return style.bold ? this.fonts.bold : this.fonts.regular;
  }

  width(text: string, style: TextStyle): number {
    return this.font(style).widthOfTextAtSize(this.clean(text, style.bold), style.size);
  }

  /** The text cut with an ellipsis so it is no wider than `maxWidth`. */
  fit(text: string, style: TextStyle, maxWidth: number): string {
    const flat = this.clean(text, style.bold);
    if (this.width(flat, style) <= maxWidth) return flat;
    let end = flat.length;
    while (end > 0 && this.width(`${flat.slice(0, end).trimEnd()}${ELLIPSIS}`, style) > maxWidth) end -= 1;
    return `${flat.slice(0, end).trimEnd()}${ELLIPSIS}`;
  }

  /** Greedy word wrap; the last line is cut with an ellipsis when `maxLines` is reached. */
  wrap(text: string, style: TextStyle, maxWidth: number, maxLines: number): string[] {
    const words = this.clean(text, style.bold).split(' ').filter((word) => word !== '');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line === '' ? word : `${line} ${word}`;
      if (line !== '' && this.width(next, style) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line !== '') lines.push(line);
    if (lines.length <= maxLines) return lines.map((entry) => this.fit(entry, style, maxWidth));
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = this.fit(`${kept[maxLines - 1] ?? ''} ${lines.slice(maxLines).join(' ')}`, style, maxWidth);
    return kept.map((entry) => this.fit(entry, style, maxWidth));
  }

  /** One line of text; `x` is its left edge, centre or right edge by `align`. */
  text(
    text: string,
    x: number,
    top: number,
    style: TextStyle,
    options: { align?: 'left' | 'center' | 'right'; page?: PDFPage } = {},
  ): void {
    const flat = this.clean(text, style.bold);
    if (flat === '') return;
    const width = this.width(flat, style);
    const left = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
    (options.page ?? this.page).drawText(flat, {
      x: left,
      y: PAGE_HEIGHT - top - style.size * ASCENT,
      size: style.size,
      font: this.font(style),
      color: style.color ?? INK,
    });
  }

  rect(x: number, top: number, width: number, height: number, fill: Color, opacity = 1): void {
    this.page.drawRectangle({ x, y: PAGE_HEIGHT - top - height, width, height, color: fill, opacity });
  }

  line(
    from: { x: number; top: number },
    to: { x: number; top: number },
    color: Color,
    thickness = 0.5,
    dash?: number[],
    page: PDFPage = this.page,
  ): void {
    page.drawLine({
      start: { x: from.x, y: PAGE_HEIGHT - from.top },
      end: { x: to.x, y: PAGE_HEIGHT - to.top },
      color,
      thickness,
      ...(dash ? { dashArray: dash } : {}),
    });
  }

  /** A filled polygon through top-left coordinates. */
  polygon(points: readonly { x: number; top: number }[], fill: Color, opacity = 1): void {
    if (points.length < 3) return;
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.top.toFixed(2)}`).join(' ');
    this.page.drawSvgPath(`${path} Z`, { x: 0, y: PAGE_HEIGHT, color: fill, opacity, borderWidth: 0 });
  }
}
