import { PDFName, PDFString } from 'pdf-lib';

import type { PdfCanvas, TextStyle } from './canvas';
import { CONTENT_WIDTH, MARGIN_X, PAGE_HEIGHT, PAGE_WIDTH } from './canvas';
import type { ReportPdfCopy } from './copy';

const PRODUCER = '@12-apps/report-builder';

const TITLE: TextStyle = { size: 18, bold: true, color: 'ink' };
const META: TextStyle = { size: 9, color: 'muted' };
const FOOT: TextStyle = { size: 7.5, color: 'muted' };

export interface DocumentFacts {
  title: string;
  periodLabel: string;
  storeName: string;
  locale: string;
  timeZone: string;
  generatedAt: Date;
}

/** "16/11/2026 08:00" or "11/16/2026 08:00", on the store's clock, with no locale-dependent spaces. */
function stampOf(at: Date, locale: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const date = locale.toLowerCase().startsWith('en')
    ? `${get('month')}/${get('day')}/${get('year')}`
    : `${get('day')}/${get('month')}/${get('year')}`;
  return `${date} ${get('hour')}:${get('minute')}`;
}

/** The metadata a reader's "document properties" shows; every date comes from the input. */
export function setMetadata(canvas: PdfCanvas, facts: DocumentFacts): void {
  const { doc } = canvas;
  doc.setTitle(facts.title);
  doc.setAuthor(facts.storeName);
  doc.setSubject(facts.periodLabel);
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  doc.setCreationDate(facts.generatedAt);
  doc.setModificationDate(facts.generatedAt);
  doc.catalog.set(PDFName.of('Lang'), PDFString.of(facts.locale));
}

/** The title, the period and the store, once, at the top of the first page. */
export function drawTitleBlock(canvas: PdfCanvas, facts: DocumentFacts, copy: ReportPdfCopy): void {
  const title = canvas.wrap(facts.title, TITLE, CONTENT_WIDTH, 2);
  for (const line of title) {
    canvas.text(line, MARGIN_X, canvas.cursor, TITLE);
    canvas.cursor += TITLE.size * 1.3;
  }
  const meta = [
    `${copy.period}: ${facts.periodLabel}`,
    `${copy.store}: ${facts.storeName}`,
    `${copy.generated}: ${stampOf(facts.generatedAt, facts.locale, facts.timeZone)}`,
  ].join('   |   ');
  for (const line of canvas.wrap(meta, META, CONTENT_WIDTH, 2)) {
    canvas.cursor += 3;
    canvas.text(line, MARGIN_X, canvas.cursor, META);
    canvas.cursor += META.size * 1.2;
  }
  canvas.cursor += 6;
  canvas.line({ x: MARGIN_X, top: canvas.cursor }, { x: MARGIN_X + CONTENT_WIDTH, top: canvas.cursor }, 'rule', 0.75);
  canvas.cursor += 14;
}

/** A footer on every page, drawn last so each knows how many pages there are. */
export function drawFooters(canvas: PdfCanvas, facts: DocumentFacts, copy: ReportPdfCopy): void {
  const total = canvas.pageCount;
  const top = PAGE_HEIGHT - 30;
  for (let index = 0; index < total; index += 1) {
    const page = canvas.pageAt(index);
    canvas.line({ x: MARGIN_X, top: top - 6 }, { x: PAGE_WIDTH - MARGIN_X, top: top - 6 }, 'rule', 0.5, undefined, page);
    const left = canvas.fit(`${facts.storeName} | ${facts.title}`, FOOT, CONTENT_WIDTH - 90);
    canvas.text(left, MARGIN_X, top, FOOT, { page });
    canvas.text(copy.page(index + 1, total), PAGE_WIDTH - MARGIN_X, top, FOOT, { page, align: 'right' });
  }
}
