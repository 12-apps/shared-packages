/**
 * A table row as a phone CARD (FUT-4063) — which column is the title, which the
 * figure, what goes under each — decided as data so it is asserted without a
 * browser.
 */
import type { ValueFormatCopy } from "../../copy";
import { columnText, type BucketFormatter } from "./column-value";
import type { ReportCardPart, ReportPhoneCards, ReportRow, ReportTableColumn } from "../reports-api";

/** One card, every string already formatted. */
interface TableCard {
  title: string;
  /** Joined parts under the title; absent when the card lists label/value lines. */
  subtitle?: string;
  lines: Array<{ label: string; value: string }>;
  figure?: { key: string; text: string };
  figureCaption?: string;
}

type Cell = (row: ReportRow, column: ReportTableColumn | undefined) => string;

function cellWith(copy: ValueFormatCopy, formatBucket?: BucketFormatter): Cell {
  return (row, column) => (column ? columnText(row[column.key], column, copy, formatBucket) : "");
}

function part(row: ReportRow, byKey: Map<string, ReportTableColumn>, entry: ReportCardPart, cell: Cell): string {
  return `${cell(row, byKey.get(entry.measure))}${entry.suffix ?? ""}`;
}

function cardTitleKey(columns: readonly ReportTableColumn[], phone: ReportPhoneCards): string | undefined {
  return phone.title ?? columns.find((column) => column.format === "text")?.key ?? columns[0]?.key;
}

/** The card for one row. The title defaults to the first text column, then the first column. */
export function tableCard(
  row: ReportRow,
  columns: readonly ReportTableColumn[],
  phone: ReportPhoneCards,
  copy: ValueFormatCopy,
  formatBucket?: BucketFormatter,
): TableCard {
  const cell = cellWith(copy, formatBucket);
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const titleKey = cardTitleKey(columns, phone);
  const used = new Set([titleKey, phone.figure, phone.figureCaption?.measure]);
  const card: TableCard = {
    title: cell(row, titleKey ? byKey.get(titleKey) : undefined),
    lines: phone.subtitle
      ? []
      : columns
          .filter((column) => !used.has(column.key))
          .map((column) => ({ label: column.label, value: cell(row, column) })),
  };
  if (phone.subtitle) {
    card.subtitle = phone.subtitle.map((entry) => part(row, byKey, entry, cell)).join(" · ");
  }
  if (phone.figure) card.figure = { key: phone.figure, text: cell(row, byKey.get(phone.figure)) };
  if (phone.figureCaption) card.figureCaption = part(row, byKey, phone.figureCaption, cell);
  return card;
}

/**
 * Whether a table draws as cards (FUT-4063): `'md'` (the default) follows the
 * viewport, `'always'` always, a number the block's own measured width — a
 * width not yet measured falls back to the viewport.
 */
export function cardsApply(phone: ReportPhoneCards | undefined, narrowViewport: boolean, blockWidth: number): boolean {
  if (!phone) return false;
  const below = phone.below ?? "md";
  if (below === "always") return true;
  if (below === "md" || blockWidth <= 0) return narrowViewport;
  return blockWidth < below;
}
