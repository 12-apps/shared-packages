/**
 * Client-side row export used by the admin data pages' `Dashboard.Export`
 * dropdown. Serialises the currently displayed rows to CSV or JSON and triggers
 * a browser download. Kept dependency-free (no xlsx lib): "Excel" is emitted as
 * CSV, which Excel opens natively.
 */

type ExportFormat = "csv" | "json";

export interface ExportColumn<T> {
  /** Column header used as the CSV/JSON key. */
  header: string;
  /** Extracts the cell value for a row. */
  value: (row: T) => string | number | boolean | null | undefined;
}

function escapeCsvCell(value: string): string {
  // Quote when the cell contains a comma, quote, or newline; double embedded quotes.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * The notes a report says about its data (FUT-4063), after the rows: a blank
 * line, then one note per line as a single cell, so a spreadsheet keeps them
 * beside the figures they qualify without inventing a column for them.
 */
export function csvTrailer(notes: readonly string[]): string {
  if (notes.length === 0) return "";
  return `\n\n${notes.map(escapeCsvCell).join("\n")}`;
}

export function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const head = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const body = rows
    .map((row) =>
      columns
        .map((column) => {
          const cell = column.value(row);
          return escapeCsvCell(cell == null ? "" : String(cell));
        })
        .join(","),
    )
    .join("\n");
  return `${head}\n${body}`;
}

function toJson<T>(rows: T[], columns: ExportColumn<T>[]): string {
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
  if (typeof window === "undefined") {
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Serialises `rows` using `columns` and downloads them as `<baseName>.<ext>`.
 *
 * @param format - `"csv"` (also used for the Excel option) or `"json"`.
 * @param baseName - File name without extension, e.g. `"produtos"`.
 */
export function exportRows<T>(
  format: ExportFormat,
  rows: T[],
  columns: ExportColumn<T>[],
  baseName: string,
  /** CSV only (FUT-4063): appended after the rows. JSON keeps its array shape. */
  notes: readonly string[] = [],
): void {
  if (format === "json") {
    triggerDownload(toJson(rows, columns), `${baseName}.json`, "application/json");
    return;
  }
  triggerDownload(`${toCsv(rows, columns)}${csvTrailer(notes)}`, `${baseName}.csv`, "text/csv;charset=utf-8");
}
