/**
 * The words the PDF writes itself: the page furniture and the notes where a
 * block is cut or empty. Everything else on a page (labels, figures, column
 * headings) is already text in the render model, written by the engine copy.
 *
 * `appName` is how the cut-table note names the place the full report lives.
 * The host passes its own product name; the package does not know one.
 */
export interface ReportPdfCopy {
  period: string;
  store: string;
  generated: string;
  /** "Página 2 de 5". */
  page(current: number, total: number): string;
  /** A report with nothing to show in the period. */
  empty: string;
  /** A block whose run failed: no engine message reaches an attachment. */
  blockError: string;
  /** What `appName` reads as when the host names none. */
  defaultAppName: string;
  /** A cut table: "e mais 120 linhas — veja no <app>". */
  moreRows(count: number, appName: string): string;
  /** A chart that drew only its first points. */
  chartTruncated(shown: number, total: number): string;
  /**
   * For the e-mail that carries the file (the host writes the body, these are its two sentences): the
   * line to use when the PDF is attached, and the line to use INSTEAD when {@link ReportPdfError} was
   * thrown, so a body never says "attached" about a file that is not there.
   */
  attachedLine: string;
  missingLine: string;
  /** The folded remainder of a pie. */
  otherSlices: string;
}
