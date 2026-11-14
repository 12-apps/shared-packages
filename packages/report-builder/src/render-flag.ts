/**
 * A table's per-row flag (FUT-4063): which rows are marked, decided on the
 * SERVER so the screen, an export and the API's own payload agree.
 */
import type { ReportRowFlag } from './spec';
import type { ReportRow } from './types';

/** The flag as the render model carries it: the judged column, its words, the marked rows. */
export interface ReportTableFlag {
  /** The column (measure alias) whose cell carries the mark. */
  column: string;
  label: string;
  /** Indices into the model's `rows`. */
  rows: number[];
}

function isEmptyFigure(value: ReportRow[string] | undefined): boolean {
  return value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value));
}

/** Whether one row is above the flag's threshold, or empty where `whenEmpty` says that counts. */
export function isRowFlagged(row: ReportRow, flag: ReportRowFlag): boolean {
  const value = row[flag.measure];
  if (typeof value === 'number' && Number.isFinite(value)) return value > flag.above;
  if (!flag.whenEmpty || !isEmptyFigure(value)) return false;
  const other = row[flag.whenEmpty.measure];
  return typeof other === 'number' && other > 0;
}

export function tableFlag(rows: ReportRow[], flag: ReportRowFlag): ReportTableFlag {
  return {
    column: flag.measure,
    label: flag.label,
    rows: rows.flatMap((row, index) => (isRowFlagged(row, flag) ? [index] : [])),
  };
}
