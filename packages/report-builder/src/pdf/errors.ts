/**
 * The typed failures of the server PDF renderer.
 *
 * A host's job reads `code` to decide what to do with the attachment, so the
 * set is closed and small. None of the messages carries a cell value, a
 * recipient or a store name: a message is safe to log.
 */
export const REPORT_PDF_ERROR_CODES = ['timeout', 'too_large', 'unsupported_block', 'render_failed'] as const;

export type ReportPdfErrorCode = (typeof REPORT_PDF_ERROR_CODES)[number];

export class ReportPdfError extends Error {
  readonly code: ReportPdfErrorCode;
  /** The size the document reached, when it was refused for its size. */
  readonly sizeBytes?: number;
  /** The pages the document reached, when it was refused for its length. */
  readonly pageCount?: number;
  /** The block that could not be drawn, for `unsupported_block`. */
  readonly blockId?: string;

  constructor(
    code: ReportPdfErrorCode,
    message: string,
    details: { sizeBytes?: number; pageCount?: number; blockId?: string; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ReportPdfError';
    this.code = code;
    if (details.sizeBytes !== undefined) this.sizeBytes = details.sizeBytes;
    if (details.pageCount !== undefined) this.pageCount = details.pageCount;
    if (details.blockId !== undefined) this.blockId = details.blockId;
  }
}

/** Anything thrown while drawing becomes `render_failed`; a typed error passes through. */
export function toReportPdfError(error: unknown): ReportPdfError {
  if (error instanceof ReportPdfError) return error;
  const reason = error instanceof Error ? error.message : 'unknown error';
  return new ReportPdfError('render_failed', `The report PDF could not be drawn: ${reason}`, { cause: error });
}
