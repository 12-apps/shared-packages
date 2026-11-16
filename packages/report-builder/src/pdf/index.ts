/**
 * `@12-apps/report-builder/pdf`: a saved report's render model drawn as a PDF
 * with vector shapes, for e-mail delivery from a server. Node only; the
 * browser's "Exportar PDF" keeps using the print path.
 */
export { renderReportPdf, DEFAULT_PDF_LIMITS } from './render-pdf';
export type { ReportPdfLimits, ReportPdfOptions, ReportPdfResult } from './render-pdf';
export { ReportPdfError, REPORT_PDF_ERROR_CODES } from './errors';
export type { ReportPdfErrorCode } from './errors';
export { REPORT_PDF_COPY, reportPdfCopyFor } from './packs';
export { PT_BR_REPORT_PDF_COPY } from './pt-BR';
export { EN_US_REPORT_PDF_COPY } from './en-US';
export type { ReportPdfCopy } from './copy';
export type { ReportPdfBlock, ReportPdfBucketFormatter, ReportPdfView } from './types';
