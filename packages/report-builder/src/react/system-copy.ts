/**
 * The built-in reports' and dashboards' words — split out of `screens-copy.ts`
 * (its 400-line gate) when the notes' copy joined them (FUT-4063).
 */

/** The host's built-in reports and dashboards. */
export interface ReportSystemCopy {
  blockFailed: string;
  dashboardMissingTitle: string;
  dashboardMissingBody: string;
  reportFailedTitle: string;
  reportFailedBody: string;
  /** The retry beside a failed system report. */
  retry: string;
  /**
   * Joins the names a report note lists, e.g. "; ". Optional (FUT-4063), so a
   * pack written before the notes keeps type-checking; absent: "; ".
   */
  noteSeparator?: string;
  /** Closes a note's list past its first three names: " e mais 2". Absent: " +2". */
  noteMore?(count: number): string;
}
