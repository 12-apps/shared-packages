/**
 * A table row as a phone CARD (FUT-4063) — which column is the title, which the
 * figure, what goes under each — decided as data so it is asserted without a
 * browser.
 */
import type { ValueFormatCopy } from "../../copy";
import { formatReportValue } from "../../format";
import type { ReportCardPart, ReportPhoneCards, ReportRow, ReportTableColumn } from "../reports-api";

/** One card, every string already formatted. */
export interface TableCard {
  title: string;
  /** Joined parts under the title; absent when the card lists label/value lines. */
  subtitle?: string;
  lines: Array<{ label: string; value: string }>;
  figure?: { key: string; text: string };
  figureCaption?: string;
}

function cell(row: ReportRow, column: ReportTableColumn | undefined, copy: ValueFormatCopy): string {
  if (!column) return "";
  return formatReportValue(row[column.key] ?? null, column.format, copy, column.decimals);
}

function part(row: ReportRow, byKey: Map<string, ReportTableColumn>, entry: ReportCardPart, copy: ValueFormatCopy): string {
  return `${cell(row, byKey.get(entry.measure), copy)}${entry.suffix ?? ""}`;
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
): TableCard {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const titleKey = cardTitleKey(columns, phone);
  const used = new Set([titleKey, phone.figure, phone.figureCaption?.measure]);
  const card: TableCard = {
    title: cell(row, titleKey ? byKey.get(titleKey) : undefined, copy),
    lines: phone.subtitle
      ? []
      : columns
          .filter((column) => !used.has(column.key))
          .map((column) => ({ label: column.label, value: cell(row, column, copy) })),
  };
  if (phone.subtitle) {
    card.subtitle = phone.subtitle.map((entry) => part(row, byKey, entry, copy)).join(" · ");
  }
  if (phone.figure) card.figure = { key: phone.figure, text: cell(row, byKey.get(phone.figure), copy) };
  if (phone.figureCaption) card.figureCaption = part(row, byKey, phone.figureCaption, copy);
  return card;
}
