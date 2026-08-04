import type { ConnectorContext } from '../connectors/types';
import { ConnectorRegistry } from '../connectors/registry';
import { defaultResearchConfig } from '../ports';
import type { ResearchConfig, ResearchDeps, ResearchRunScope } from '../ports';
import { notifyRunFinished, notifySourceSettled, notifySourceStarted } from './progress';
import { querySource } from './query-source';
import { scoreSourceOffers } from './score-offers';
import { dedupeOffers } from '../ranking/dedupe';
import { flagSuspectUnitPrices } from '../ranking/plausibility';
import { rankOffers } from '../ranking/rank';
import type { ResearchQuery, RunResult, ScoredOffer, SourceStat } from '../types';

export interface RunResearchInput {
  clientId: string;
  requestId: string;
  query: ResearchQuery;
}

/** Everything the fan-out needs, as one object (the arg-count bar). */
interface CollectContext {
  deps: ResearchDeps;
  registry: ConnectorRegistry;
  ctx: ConnectorContext;
  config: ResearchConfig;
  scope: ResearchRunScope;
  query: ResearchQuery;
  /** One freshness horizon for the whole run — see `runResearch`. */
  expiresAt: Date;
}

/**
 * Ask every enabled source at once. Each source announces itself, is queried,
 * has its offers SCORED, and reports both the moment it settles (FUT-439 for
 * the stat, FUT-519 for the offers) — persisted incrementally and emitted
 * through the host's event seam — instead of the roster and the price table
 * staying empty until the slowest source answers.
 */
const collectFromSources = async (
  context: CollectContext,
): Promise<{ stats: SourceStat[]; scored: ScoredOffer[] }> => {
  const { deps, registry, ctx, config, scope, query, expiresAt } = context;
  const sources = await deps.store.listEnabledSources(scope.clientId);
  const collected = await Promise.all(
    sources.map(async (source) => {
      await notifySourceStarted(deps, scope, source);
      const outcome = await querySource(source, query, deps, config, registry, ctx);
      const scored = scoreSourceOffers(outcome, query, expiresAt, config.minRelevance);
      await notifySourceSettled(deps, scope, outcome.stat, scored);
      return { stat: outcome.stat, scored };
    }),
  );
  return {
    stats: collected.map((entry) => entry.stat),
    scored: collected.flatMap((entry) => entry.scored),
  };
};

/**
 * The whole engine in one call: fan out to the tenant's enabled sources
 * (cache/budget-gated), normalize raw offers to unit prices, score relevance,
 * drop everything below threshold, rank cheapest-first, persist. Designed to
 * run inside a host job handler — idempotent per runId and safe to retry.
 */
export const runResearch = async (
  deps: ResearchDeps,
  registry: ConnectorRegistry,
  ctx: ConnectorContext,
  input: RunResearchInput,
  overrides: Partial<ResearchConfig> = {},
): Promise<RunResult> => {
  const config: ResearchConfig = { ...defaultResearchConfig, ...overrides };
  const now = deps.now ?? (() => new Date());

  const { id: runId } = await deps.store.createRun({
    clientId: input.clientId,
    requestId: input.requestId,
  });
  const scope: ResearchRunScope = { clientId: input.clientId, requestId: input.requestId, runId };
  await deps.store.updateRun({ runId, status: 'RUNNING', startedAt: now() });

  try {
    // Fixed BEFORE the fan-out (FUT-519): offers are scored as each source
    // lands, so a horizon read per source would hand the slowest source a
    // longer TTL than the fastest for the same query.
    const expiresAt = new Date(now().getTime() + config.ttlSeconds * 1000);
    const { stats: sourceStats, scored } = await collectFromSources({
      deps,
      registry,
      ctx,
      config,
      scope,
      query: input.query,
      expiresAt,
    });

    // Dedupe AFTER ranking: the same listing reached via two connectors
    // (identity = normalized URL/ASIN) keeps only its best-ranked instance.
    // Then the plausibility guard (FUT-497), last of the three: its reference
    // is the median of the offers the buyer will actually see, so it must run
    // on the deduped set — and it only ADDS a flag, never touches a rank.
    //
    // ENGINE CONTRACT ONLY. `suspectUnitPrice` is derived, not a column, so
    // `insertOffers` drops it and no buyer-facing surface reads it from here:
    // every badge comes from the host recomputing the flag on the read (see
    // `getResearchRun`). It stays on the returned offers because that array IS
    // the library's answer — an embedder without a database gets the judgement
    // too — and because the recomputation must agree with it. The two sets can
    // differ once rows are hidden, which is exactly why the read path judges
    // its own rows instead of trusting these.
    const ranked = flagSuspectUnitPrices(
      dedupeOffers(rankOffers(scored, input.query.quantity)),
    );
    // REPLACES the per-source appends (FUT-519): ranks, dedupe and the flag
    // land exactly once, so every reader sees one source of truth.
    await deps.store.insertOffers({ clientId: input.clientId, runId, offers: ranked });

    await deps.store.updateRun({
      runId,
      status: 'COMPLETED',
      sourceStats,
      finishedAt: now(),
    });
    await notifyRunFinished(deps, scope, 'COMPLETED');
    return { runId, status: 'COMPLETED', offers: ranked, sourceStats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.error('product-research run failed', { runId, error: message });
    await deps.store.updateRun({ runId, status: 'FAILED', error: message, finishedAt: now() });
    await notifyRunFinished(deps, scope, 'FAILED');
    return { runId, status: 'FAILED', offers: [], sourceStats: [] };
  }
};
