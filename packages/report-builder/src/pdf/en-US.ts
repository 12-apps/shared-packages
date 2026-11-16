import type { ReportPdfCopy } from './copy';

export const EN_US_REPORT_PDF_COPY: ReportPdfCopy = {
  period: 'Period',
  store: 'Store',
  generated: 'Generated',
  page: (current, total) => `Page ${current} of ${total}`,
  empty: 'No data for this period.',
  blockError: 'This block could not be shown.',
  defaultAppName: 'the app',
  moreRows: (count, appName) => `and ${count} more ${count === 1 ? 'row' : 'rows'} — see them in ${appName}`,
  chartTruncated: (shown, total) => `Showing the first ${shown} of ${total} points.`,
  otherSlices: 'Other',
};
