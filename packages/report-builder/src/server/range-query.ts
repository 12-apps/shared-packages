import { messagesOf, windowOf, type ReportBuilderServerConfig, type ReportRequest } from './context';
import { invalidInputError } from './problems';
import type { ResolvedReportRange } from './range';
import { reportRangeQuery } from './wire-range';

/**
 * The window a GET names in its query: `reportRangeQuery` first, so a key it
 * does not declare or a value it refuses is a 422 (with every problem) and not
 * a default quietly run, then the same resolution every route shares.
 */
export function windowOfQuery(
  config: ReportBuilderServerConfig,
  request: Pick<ReportRequest, 'query' | 'locale'>,
): ResolvedReportRange {
  const messages = messagesOf(config, request.locale);
  const parsed = reportRangeQuery(messages.range).safeParse(request.query);
  if (!parsed.success) throw invalidInputError(parsed.error, messages.invalidBody);
  return windowOf(config, request);
}
