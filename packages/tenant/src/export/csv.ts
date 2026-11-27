/**
 * The archive's CSV: RFC 4180 quoting with CRLF, the BOM a spreadsheet needs
 * to read UTF-8 on the header line, and formula neutralisation of every cell a
 * person may have typed. The archive is opened in a spreadsheet by its owner,
 * so a cell that starts with `=`, `+`, `-`, `@`, a tab or a CR gets a leading
 * `'` and is read as text. The bytes are the extracted host writer's,
 * unchanged (the golden test).
 */
import type { TenantExportCell } from './types';

/** A cell a spreadsheet would read as a formula. */
const FORMULA = /^[=+\-@\t\r]/u;

/** A cell that needs quoting. */
const QUOTED = /[",;\r\n]/u;

/** A cell made inert for a spreadsheet: a leading formula character is read as text. */
export function defused(text: string): string {
  return FORMULA.test(text) ? `'${text}` : text;
}

/** A section's cell as written: a typed one neutralised, a raw one as it is. */
export function cellText(cell: TenantExportCell): string {
  return typeof cell === 'string' ? defused(cell) : cell.raw;
}

/** One CSV line (RFC 4180, CRLF). */
export function csvLine(cells: readonly string[]): string {
  return `${cells.map((cell) => (QUOTED.test(cell) ? `"${cell.replace(/"/gu, '""')}"` : cell)).join(',')}\r\n`;
}

/** The header line, with the BOM a spreadsheet needs to read UTF-8. */
export function csvHeader(headers: readonly string[]): string {
  return `﻿${csvLine(headers)}`;
}
