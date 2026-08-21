/**
 * Serialise rows and hand the browser a download.
 *
 * The companion of the grid's Export control, which emits a REQUEST and leaves
 * the producing to the host — this is the producing half, for the common case
 * where the host already has the rows and only needs a file out of them.
 *
 * Dependency-free on purpose: "Excel" is emitted as CSV, which Excel opens
 * natively. A spreadsheet library would add ~700KB to a bundle for column
 * widths nobody asked for, and the one thing a real `.xlsx` buys — types that
 * survive the round trip — is not something a CSV export of an admin list is
 * being asked for.
 */

type ExportFormat = 'csv' | 'json';

/** One column of the exported file: its header, and how to read a row. */
export interface ExportColumn<T> {
  /** Column header, used as the CSV column and the JSON key. */
  header: string;
  /** Extract the cell value for a row. */
  value: (row: T) => string | number | boolean | null | undefined;
}

function escapeCsvCell(value: string): string {
  // Quote when the cell contains a comma, a quote or a newline; double any
  // embedded quote. Without this a name with a comma silently shifts every
  // column after it by one, which reads as corrupt data rather than as a bug.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv<T>(rows: readonly T[], columns: readonly ExportColumn<T>[]): string {
  const head = columns.map((column) => escapeCsvCell(column.header)).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((column) => {
          const cell = column.value(row);
          return escapeCsvCell(cell == null ? '' : String(cell));
        })
        .join(','),
    )
    .join('\n');
  return `${head}\n${body}`;
}

function toJson<T>(rows: readonly T[], columns: readonly ExportColumn<T>[]): string {
  const records = rows.map((row) => {
    const record: Record<string, string | number | boolean | null> = {};
    for (const column of columns) {
      const cell = column.value(row);
      record[column.header] = cell == null ? null : (cell as string | number | boolean);
    }
    return record;
  });
  return JSON.stringify(records, null, 2);
}

function triggerDownload(content: string, filename: string, mimeType: string): void {
  // A no-op without a document, so a module that imports this can still be
  // loaded by a test runner or a server render without guarding the import.
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Serialise `rows` using `columns` and download them as `<baseName>.<ext>`.
 *
 * @param format - `csv` (also what the Excel option produces) or `json`.
 * @param baseName - File name without extension; the consumer's word for the
 *   collection, so it is never derived from a type name here.
 */
export function exportRows<T>(
  format: ExportFormat,
  rows: readonly T[],
  columns: readonly ExportColumn<T>[],
  baseName: string,
): void {
  if (format === 'json') {
    triggerDownload(toJson(rows, columns), `${baseName}.json`, 'application/json');
    return;
  }
  triggerDownload(toCsv(rows, columns), `${baseName}.csv`, 'text/csv;charset=utf-8');
}
