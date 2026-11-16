import { PDFDocument, type Color, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ChartSemanticColor } from '@12-apps/ui/charts';

import { ReportPdfError } from './errors';
import { fontFiles } from './fonts';
import { createPdfPalette, type PdfPalette, type ReportPdfTheme, type Tone } from './theme';

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
/** The narrowest a glyph of the face gets, in em: the cap on how much text can ever fit a width. */
const NARROWEST_EM = 0.2;
const MEASURE_CACHE_LIMIT = 4000;
const CACHEABLE_LENGTH = 120;
/** Format controls (zero-width, bidi, BOM), variation selectors and line separators: invisible, so never drawn. */
const INVISIBLE = /[\p{Cf}\p{Variation_Selector}\p{Zl}\p{Zp}]/gu;
const SPACES = /[\u00a0\u202f\u2007\u2009\u200a]/g;

/**
 * What stands in for a character Noto Sans has no glyph for, where ASCII says the
 * same thing: it covers letters, accents, currency and the minus sign, but not
 * arrows or comparisons. Anything else it lacks is dropped.
 */
const STAND_IN: Readonly<Record<string, string>> = {
  '\u2192': '->',
  '\u2190': '<-',
  '\u2194': '<->',
  '\u2265': '>=',
  '\u2264': '<=',
  '\u2248': '~',
  '\u2260': '!=',
};

interface PdfLimits {
  maxPages: number;
  timeoutMs: number;
}

export interface TextStyle {
  size: number;
  bold?: boolean;
  color?: Tone | Color;
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
 * is done here, once. Text is set in an embedded Noto Sans subset; a character
 * the face has no glyph for is dropped, never printed as a question mark.
 */
export class PdfCanvas {
  readonly doc: PDFDocument;
  readonly palette: PdfPalette;
  private readonly fonts: Fonts;
  private readonly pages: PDFPage[] = [];
  private readonly encodable: { regular: Set<number>; bold: Set<number> };
  private readonly widths = new Map<string, number>();
  private readonly started: number;
  cursor = MARGIN_TOP;

  private constructor(
    doc: PDFDocument,
    fonts: Fonts,
    palette: PdfPalette,
    private readonly limits: PdfLimits,
    private readonly clock: () => number,
  ) {
    this.doc = doc;
    this.fonts = fonts;
    this.palette = palette;
    this.encodable = {
      regular: new Set(fonts.regular.getCharacterSet()),
      bold: new Set(fonts.bold.getCharacterSet()),
    };
    this.started = clock();
    this.newPage();
  }

  static async create(limits: PdfLimits, clock: () => number, theme?: ReportPdfTheme): Promise<PdfCanvas> {
    const doc = await PDFDocument.create({ updateMetadata: false });
    doc.registerFontkit(fontkit);
    const files = fontFiles();
    // A fixed subset name keeps the bytes the same from one run to the next.
    const fonts = {
      regular: await doc.embedFont(files.regular, { subset: true, customName: 'AAAAAA+NotoSans-Regular' }),
      bold: await doc.embedFont(files.bold, { subset: true, customName: 'AAAAAB+NotoSans-Bold' }),
    };
    return new PdfCanvas(doc, fonts, createPdfPalette(theme), limits, clock);
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

  tone(value: Tone | Color | undefined, fallback: Tone = 'ink'): Color {
    if (value === undefined) return this.palette.tones[fallback];
    return typeof value === 'string' ? this.palette.tones[value] : value;
  }

  accent(token: ChartSemanticColor): Color {
    return this.palette.accents[token];
  }

  /** Fail fast once the render budget is spent; cheap enough to call per row. */
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

  /**
   * The text as the face can set it: composed (NFC, so "c" + a combining tilde
   * is one "ã"), with spaces and line breaks flattened, invisible controls
   * removed and any character with no glyph dropped.
   */
  clean(text: string, bold = false): string {
    const set = bold ? this.encodable.bold : this.encodable.regular;
    let out = '';
    const flat = text.normalize('NFC').replace(SPACES, ' ').replace(INVISIBLE, '').replace(/[\r\n\t]+/g, ' ');
    for (const char of flat) out += set.has(char.codePointAt(0) ?? 0) ? char : (STAND_IN[char] ?? '');
    return out.replace(/ {2,}/g, ' ');
  }

  private font(style: TextStyle): PDFFont {
    return style.bold ? this.fonts.bold : this.fonts.regular;
  }

  /** The width of text that is already clean. Repeats of short strings are remembered. */
  private measure(flat: string, style: TextStyle): number {
    const key = flat.length <= CACHEABLE_LENGTH ? `${style.bold ? 'b' : 'r'}${style.size}|${flat}` : undefined;
    const known = key === undefined ? undefined : this.widths.get(key);
    if (known !== undefined) return known;
    const width = this.font(style).widthOfTextAtSize(flat, style.size);
    if (key !== undefined && this.widths.size < MEASURE_CACHE_LIMIT) this.widths.set(key, width);
    return width;
  }

  width(text: string, style: TextStyle): number {
    return this.measure(this.clean(text, style.bold), style);
  }

  /** How many characters can possibly fit `maxWidth`: what any longer text is cut to before it is measured. */
  private reach(style: TextStyle, maxWidth: number): number {
    return Math.ceil(maxWidth / (style.size * NARROWEST_EM)) + 2;
  }

  /**
   * The text cut with an ellipsis so it is no wider than `maxWidth`.
   *
   * Cost is bounded by the WIDTH, not by the text: anything longer than what
   * could possibly fit is cut before it is measured, and the cut point is found
   * by bisection, so a 50,000-character cell costs the same as a 200-character one.
   */
  fit(text: string, style: TextStyle, maxWidth: number): string {
    const cap = this.reach(style, maxWidth);
    const head = text.length > cap * 2 ? text.slice(0, cap * 2) : text;
    const chars = [...this.clean(head, style.bold)];
    const used = chars.slice(0, cap);
    const whole = used.join('');
    if (used.length === chars.length && head === text && this.measure(whole, style) <= maxWidth) return whole;
    let low = 0;
    let high = used.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (this.measure(`${used.slice(0, mid).join('').trimEnd()}${ELLIPSIS}`, style) <= maxWidth) low = mid;
      else high = mid - 1;
    }
    return `${used.slice(0, low).join('').trimEnd()}${ELLIPSIS}`;
  }

  /** Greedy word wrap; the last line is cut with an ellipsis when `maxLines` is reached. */
  wrap(text: string, style: TextStyle, maxWidth: number, maxLines: number): string[] {
    const budget = this.reach(style, maxWidth) * maxLines * 2;
    const words = this.clean(text.slice(0, budget), style.bold).split(' ').filter((word) => word !== '');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line === '' ? word : `${line} ${word}`;
      if (line !== '' && this.measure(next, style) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
      if (lines.length > maxLines) break;
    }
    if (line !== '') lines.push(line);
    if (lines.length <= maxLines) return lines.map((entry) => this.fit(entry, style, maxWidth));
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1] ?? ''} ${lines.slice(maxLines).join(' ')}`;
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
    const width = this.measure(flat, style);
    const left = options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
    (options.page ?? this.page).drawText(flat, {
      x: left,
      y: PAGE_HEIGHT - top - style.size * ASCENT,
      size: style.size,
      font: this.font(style),
      color: this.tone(style.color),
    });
  }

  rect(
    x: number,
    top: number,
    width: number,
    height: number,
    fill: Tone | Color,
    options: { opacity?: number; border?: { color: Tone | Color; width: number } } = {},
  ): void {
    this.page.drawRectangle({
      x,
      y: PAGE_HEIGHT - top - height,
      width,
      height,
      color: this.tone(fill),
      opacity: options.opacity ?? 1,
      ...(options.border
        ? { borderColor: this.tone(options.border.color), borderWidth: options.border.width }
        : {}),
    });
  }

  /** A rectangle with only an outline. */
  outline(x: number, top: number, width: number, height: number, color: Tone | Color, thickness: number): void {
    this.page.drawRectangle({
      x,
      y: PAGE_HEIGHT - top - height,
      width,
      height,
      borderColor: this.tone(color),
      borderWidth: thickness,
      opacity: 0,
    });
  }

  line(
    from: { x: number; top: number },
    to: { x: number; top: number },
    color: Tone | Color,
    thickness = 0.5,
    dash?: number[],
    page: PDFPage = this.page,
  ): void {
    page.drawLine({
      start: { x: from.x, y: PAGE_HEIGHT - from.top },
      end: { x: to.x, y: PAGE_HEIGHT - to.top },
      color: this.tone(color),
      thickness,
      ...(dash ? { dashArray: dash } : {}),
    });
  }

  /** Diagonal strokes across a rectangle: the print-safe second signal beside a colour. */
  hatch(x: number, top: number, width: number, height: number, color: Tone | Color, gap = 3.5): void {
    for (let offset = -height; offset < width; offset += gap) {
      const x0 = Math.max(x, x + offset);
      const x1 = Math.min(x + width, x + offset + height);
      if (x1 <= x0) continue;
      this.line(
        { x: x0, top: top + height - (x0 - (x + offset)) },
        { x: x1, top: top + height - (x1 - (x + offset)) },
        color,
        0.6,
      );
    }
  }

  /** A filled polygon through top-left coordinates. */
  polygon(points: readonly { x: number; top: number }[], fill: Tone | Color, opacity = 1): void {
    if (points.length < 3) return;
    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.top.toFixed(2)}`).join(' ');
    this.page.drawSvgPath(`${path} Z`, { x: 0, y: PAGE_HEIGHT, color: this.tone(fill), opacity, borderWidth: 0 });
  }
}
