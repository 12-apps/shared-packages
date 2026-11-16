import type { ReportPdfCopy } from './copy';
import { EN_US_REPORT_PDF_COPY } from './en-US';
import { PT_BR_REPORT_PDF_COPY } from './pt-BR';

export const REPORT_PDF_COPY = {
  'pt-BR': PT_BR_REPORT_PDF_COPY,
  'en-US': EN_US_REPORT_PDF_COPY,
} as const satisfies Record<'pt-BR' | 'en-US', ReportPdfCopy>;

/** The pack for a BCP-47 tag: English for any `en`, Portuguese for everything else. */
export function reportPdfCopyFor(locale: string): ReportPdfCopy {
  return locale.toLowerCase().startsWith('en') ? EN_US_REPORT_PDF_COPY : PT_BR_REPORT_PDF_COPY;
}
