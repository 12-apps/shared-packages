/**
 * `@12-apps/product-research/jobs` — the package's job blueprint, deps left
 * open.
 *
 * The run job's RETRY POLICY has always been this package's claim, scattered
 * through its comments: three attempts, exponentially spaced from five
 * seconds, cheap because the pipeline is idempotent per runId and the
 * source-budget truncation makes attempts two and three nearly free. The
 * origin host restates those numbers in its own `defineJob` today; declared
 * here, they live where the reasoning lives.
 *
 * This is the first PAYLOAD-CARRYING blueprint (shift's auto-close is a
 * scheduled sweep): one buyer request enqueues one run, and the payload is
 * `RunResearchInput`. No schedule, no interval, no lease — idempotency is
 * per-`runId`, not a single-flight name.
 *
 * The host binds ONE dep: `runResearch`, its registry, connector context and
 * config overrides closed over — the contract's host-computed-argument rule,
 * which keeps the blueprint inert and the mount data where the vocabulary
 * lives.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency (the report-builder move):
 * the value is a plain `satisfies`-checked object — declaring it registers
 * nothing and starts nothing.
 */

import type { JobsContribution } from '@12-apps/wiring';

import type { RunResearchInput } from './pipeline/run-research';
import type { RunResult } from './types';

export interface ResearchJobDeps {
  /**
   * Run one research pipeline for one request. The host closes its
   * `ConnectorRegistry`, `ConnectorContext` and config overrides over this;
   * the pipeline reports through its own LoggerPort, so the handler adds the
   * retry policy and the wire name, never a second log stream.
   */
  runResearch(input: RunResearchInput): Promise<RunResult>;
}

export const RESEARCH_JOBS = {
  namespace: 'research',
  blueprints: {
    run: {
      name: 'run',
      /** Three attempts total — the pipeline is idempotent per runId. */
      attempts: 3,
      /** 5s → 10s → 20s, the spacing the source-budget truncation assumes. */
      backoff: { type: 'exponential', delayMs: 5_000 },
      async handle(payload: RunResearchInput, deps: ResearchJobDeps) {
        await deps.runResearch(payload);
      },
    },
  },
} satisfies JobsContribution<ResearchJobDeps>;
