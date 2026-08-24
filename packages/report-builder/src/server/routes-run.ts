import { invalidSpecError } from '../errors';
import { runReport } from '../run';

import {
  messagesOf,
  foldSpecError,
  forbidden,
  mayQueryEntity,
  ok,
  runOptions,
  toReportRangeView,
  windowOfBody,
  type ReportBuilderServerConfig,
  type ReportRoute,
} from './context';
import { runReportBody } from './wire';

/**
 * `POST /reports/run` — the builder's live preview: compile and run a spec
 * that was never saved. Also the MCP `runReport` tool, which is why the 400s
 * carry the compiler's own message: an LLM author reads it and corrects the
 * spec on the next call.
 */
export function runRoute(config: ReportBuilderServerConfig): ReportRoute {
  return {
    method: 'POST',
    path: '/reports/run',
    async handle({ actor, body, locale }) {
      try {
        const parsed = runReportBody(messagesOf(config, locale).range).safeParse(body);
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          throw invalidSpecError(
            first ? `${first.path.join('.') || 'body'}: ${first.message}` : messagesOf(config, locale).invalidBody,
          );
        }
        // The entity gate runs BEFORE the spec reaches the adapter: a spec is
        // the caller's own text, and the only thing standing between it and a
        // table is this check.
        if (!mayQueryEntity(config, actor, parsed.data.spec.entity)) return forbidden(config);
        const range = windowOfBody(config, parsed.data);
        const result = await runReport(parsed.data.spec, await runOptions(config, actor, range));
        return ok({ range: toReportRangeView(range), render: result.render });
      } catch (error) {
        return foldSpecError(error);
      }
    },
  };
}
