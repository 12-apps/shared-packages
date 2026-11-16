import type { ReportRenderModel } from '../render';
import type { TimeGrain } from '../types';
import type { ReportPdfCopy } from './copy';
import type { PdfCanvas } from './canvas';

/** One block of the report, as the run pipeline returns it. A dashboard's blocks fit as they are. */
export type ReportPdfBlock =
  | {
      id: string;
      title?: string;
      /** Grid columns of 12. Charts and KPI tiles sit side by side by it; tables take the width. */
      span?: number;
      /** The spec in words, shown small under the title. */
      sentence?: string;
      status: 'ok';
      render: ReportRenderModel;
    }
  | { id: string; title?: string; span?: number; sentence?: string; status: 'error' };

/**
 * What the renderer draws: a dashboard's blocks, or one report's render model
 * (which becomes a single block).
 */
export type ReportPdfView =
  | { blocks: readonly ReportPdfBlock[] }
  | { render: ReportRenderModel; sentence?: string };

/** How a dimension that names a `bucketFormat` reads, the same hook the screen takes. */
export type ReportPdfBucketFormatter = (
  value: string,
  options: { format: string; grain?: TimeGrain },
) => string;

/** What every block painter needs, resolved once per document. */
export interface PdfPaintContext {
  canvas: PdfCanvas;
  copy: ReportPdfCopy;
  appName: string;
  /** The `values` half of the engine copy: how a boolean cell reads. */
  values: { booleanTrue: string; booleanFalse: string };
  formatBucket?: ReportPdfBucketFormatter;
  maxTableRows: number;
  maxChartPoints: number;
}
