import type {
  CatalogItem,
  CatalogRef,
  ResearchQuery,
  RunStatus,
  ScoredOffer,
  SourceRecord,
  SourceStat,
} from './types';

/**
 * Host-provided seams. The package never imports a database client, a cache
 * library, a queue or a catalog — it receives these at mount time, which is
 * what lets a second product (e.g. dental supplies) reuse the whole engine by
 * implementing four small interfaces.
 */

/** Persistence surface the pipeline needs. Host implements over its ORM. */
export interface ResearchStore {
  listEnabledSources(clientId: string): Promise<SourceRecord[]>;
  createRun(input: { clientId: string; requestId: string }): Promise<{ id: string }>;
  updateRun(input: {
    runId: string;
    status: RunStatus;
    sourceStats?: SourceStat[];
    error?: string;
    startedAt?: Date;
    finishedAt?: Date;
  }): Promise<void>;
  /**
   * Optional: record one source's stat the moment that source settles, while
   * the run is still in flight (FUT-439) — what lets a poll (or a client that
   * subscribed after an event was emitted) see partial per-source progress
   * instead of an empty list until every source answers. Best-effort: the
   * final `updateRun` writes the complete, authoritative array regardless.
   * Optional so existing hosts keep compiling.
   */
  appendRunSourceStat?(input: { runId: string; stat: SourceStat }): Promise<void>;
  /**
   * Optional: record one source's scored offers the moment that source settles
   * (FUT-519) — the offers half of the same partial-progress story
   * {@link ResearchStore.appendRunSourceStat} tells for statuses, so a buyer
   * reads prices while the slowest source is still answering instead of a
   * status roster over an empty table. Best-effort, exactly like the stat
   * write: a failure here costs the partial view, never the run.
   *
   * Rows written here carry NO rank, and that is load-bearing rather than a
   * simplification. The run's order is cheapest-first across ALL sources, so it
   * is not knowable until every source has answered; a provisional per-source
   * 1..n would be actively WRONG, because the read orders `rank asc NULLS LAST`
   * and would therefore pin the first source's entire batch above every later
   * source's cheaper offers. Left null, the read's `totalCents asc` fallback
   * already reproduces the final order (see `getResearchRun` in
   * `apps/web/lib/repositories/research.ts`), so later sources INSERT into
   * position instead of permuting rows already on screen.
   *
   * {@link ResearchStore.insertOffers} is consequently the run's AUTHORITATIVE
   * set and REPLACES anything appended for that runId — a no-op for a host that
   * never appends, and what keeps ranking, dedupe and the plausibility flag
   * exactly-once for one that does.
   */
  appendRunOffers?(input: {
    clientId: string;
    runId: string;
    offers: ScoredOffer[];
  }): Promise<void>;
  /**
   * The run's final, ranked, deduped offer set. REPLACES every row already
   * written for this runId (see {@link ResearchStore.appendRunOffers}) — an
   * empty array therefore clears the partials rather than leaving them behind.
   */
  insertOffers(input: { clientId: string; runId: string; offers: ScoredOffer[] }): Promise<void>;
  markSourceDegraded(input: { sourceId: string; error: string; at: Date }): Promise<void>;
  /**
   * Optional: flip a DEGRADED source back to ACTIVE after it answers a live
   * search again. Without it the degraded mark is a one-way latch — the UI
   * keeps warning about a source that recovered, and an edge-triggered host
   * alert (see {@link SourceDegradedEvent.previousStatus}) can never re-arm.
   * Optional so existing hosts keep compiling; the pipeline calls it only on
   * a live OK answer, never on a cache hit.
   */
  markSourceRecovered?(input: { sourceId: string; at: Date }): Promise<void>;
}

/** Best-effort cache. A miss and an outage look the same: null. */
export interface CachePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * One source's transition into a failing state, as the pipeline observed it.
 * `previousStatus` is what the source row held when the run loaded it, so a
 * host can tell a fresh degradation (`ACTIVE`) from a source that keeps
 * failing (`DEGRADED`) and alert only on the edge.
 */
export interface SourceDegradedEvent {
  sourceId: string;
  clientId: string;
  sourceType: string;
  sourceName: string;
  previousStatus: 'ACTIVE' | 'DEGRADED';
  error: string;
  at: Date;
}

/** The (clientId, requestId, runId) triple every run-progress event carries. */
export interface ResearchRunScope {
  clientId: string;
  requestId: string;
  runId: string;
}

/**
 * Per-source run progress as the pipeline observes it (FUT-439), emitted
 * incrementally — `source-started` when the fan-out asks a source,
 * `source-settled` the moment THAT source answers (with its full stat:
 * OK/CACHED with an offer count, FAILED, BUDGET_EXCEEDED, SKIPPED — any of the
 * first three possibly carrying `truncated`, the per-source ceiling's carrier
 * flag rather than a sixth status), and
 * `run-finished` once after the terminal write. What the host does with them
 * (publish on a realtime channel, count a metric) is not this package's
 * business.
 */
export type ResearchRunProgressEvent =
  | (ResearchRunScope & {
      kind: 'source-started';
      sourceId: string;
      sourceType: string;
      sourceName: string;
      at: Date;
    })
  | (ResearchRunScope & { kind: 'source-settled'; stat: SourceStat; at: Date })
  | (ResearchRunScope & { kind: 'run-finished'; status: 'COMPLETED' | 'FAILED'; at: Date });

/**
 * Host-side observers of pipeline facts. Optional and best-effort: the
 * pipeline emits AFTER the durable write (`markSourceDegraded`) and swallows
 * observer failures — a dead notification transport must never fail a
 * research run. The package knows nothing about what the host does with the
 * event (notify admins, page someone, count a metric).
 */
export interface ResearchEventsPort {
  sourceDegraded(event: SourceDegradedEvent): Promise<void> | void;
  /**
   * Optional: per-source run progress (FUT-439). Absent = nothing listens —
   * existing hosts keep working unchanged. Same doctrine as `sourceDegraded`:
   * emitted after the corresponding durable write, failures are swallowed.
   */
  runProgress?(event: ResearchRunProgressEvent): Promise<void> | void;
}

/**
 * Per-key request pacing for the fetch path. `acquire` resolves when one more
 * request to `key` (a hostname) is allowed at `ratePerSecond`; the pipeline
 * awaits it before every connector fetch, so a burst of sources sharing one
 * store domain cannot hammer it. Implementations should FAIL OPEN: a broken
 * limiter backend must delay research, never break it.
 */
export interface RateLimiterPort {
  acquire(key: string, ratePerSecond: number): Promise<void>;
}

/**
 * Spend gate for paid sources, consulted BEFORE each call. `tryConsume`
 * atomically checks and reserves; false = cap reached, the source is skipped
 * with a visible BUDGET_EXCEEDED stat, never silently.
 *
 * A RESERVATION IS NOT REFUNDED WHEN THE CALL FAILS, and that is deliberate
 * (FUT-502). A production `google_shopping` search was aborted by our own 10s
 * timeout at 10346ms and still recorded `costUnits 1`, which reads like an
 * accounting bug until you follow the money: SearchApi bills successful searches
 * (HTTP 200) and a client-side abort does not cancel work already in flight — a
 * search the vendor finished at 10.5s, after we hung up, is a billed search
 * whose result we threw away. We cannot observe which side of our abort the
 * vendor landed on, so "spent" is the only claim the evidence supports;
 * un-counting it would under-report a real invoice and let a slow vendor drain
 * the account past its cap. The connector's recorded reason says so in words, so
 * the unit on a timed-out stat is explainable rather than mysterious.
 *
 * The fix for the SPEND is therefore not accounting, it is not timing out on a
 * healthy call: hence the per-connector budget (`FetchInit.timeoutMs`).
 */
export interface BudgetPort {
  tryConsume(input: { clientId: string; sourceType: string; units: number }): Promise<boolean>;
}

/** The one host-catalog seam. A restaurant maps MenuItem, a dental system its own products. */
export interface CatalogAdapter {
  searchItems(term: string): Promise<CatalogItem[]>;
  getItem(ref: CatalogRef): Promise<CatalogItem | null>;
}

export interface LoggerPort {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/** Everything the pipeline runs with — assembled by the host at mount time. */
export interface ResearchDeps {
  store: ResearchStore;
  cache: CachePort;
  budget: BudgetPort;
  logger: LoggerPort;
  /** Optional observers (degradation alerts). Absent = nothing listens. */
  events?: ResearchEventsPort;
  /** Optional per-domain fetch pacing. Absent = unthrottled (legacy hosts). */
  rateLimiter?: RateLimiterPort;
  /** Clock seam so freshness/expiry is testable. */
  now?: () => Date;
}

export interface ResearchConfig {
  /** Offers scoring below this are dropped. */
  minRelevance: number;
  /** Cache + offer freshness horizon. */
  ttlSeconds: number;
  /** Source types that consume paid budget. */
  paidSourceTypes: readonly string[];
  /**
   * The wall-clock ceiling ONE source may spend answering, in ms (FUT-516).
   *
   * Every exchange was already bounded (10s per hop, 2× that per redirect walk)
   * but nothing bounded a source: `vtexConnector.search` can issue six of them
   * — regions probe, intelligent-search, its EAN→text fallback, the legacy
   * catalog search, ITS fallback, and the delivery simulation — for ~120s, and
   * the run job retries three times, so one request could hold ~360s of worker.
   *
   * 60s is derived, not picked: one exchange ceiling is 20s, and VTEX's healthy
   * regionalized path is three exchanges (the redirect-heaviest measured at
   * ~6.5s in `apps/web/lib/research/hop-budget.ts`). Three FULL exchange
   * ceilings is therefore the smallest bound that cannot cut any path we have
   * measured, while halving the pathological six. The host derives the same
   * number from its own hop constants and overrides this — see
   * `defaultSourceBudgetMs` — so the two can never drift.
   */
  sourceBudgetMs: number;
  /**
   * TTL for a TRUNCATED answer, in seconds. Short on purpose: a cut answer is a
   * partial one, and pinning it for the 24h `ttlSeconds` would make one unlucky
   * minute the tenant's price list for a day. Long enough that the job's three
   * attempts (5s→10s→20s apart) all hit it instead of re-paying the ceiling —
   * which is what makes `attempts: 3` cheap rather than 3× the damage.
   */
  truncatedTtlSeconds: number;
}

export const defaultResearchConfig: ResearchConfig = {
  minRelevance: 0.95,
  ttlSeconds: 24 * 60 * 60,
  paidSourceTypes: ['SERP', 'AMAZON'],
  sourceBudgetMs: 60_000,
  truncatedTtlSeconds: 300,
};

/**
 * Cache key for one source's answer to one query in one region. Quantity is
 * deliberately excluded: connectors must return quantity-independent raw
 * offers (the connector contract — see connectors/types.ts) so a repeat
 * research with a different amount still hits the cache; all quantity math
 * happens in the pipeline.
 */
export const cacheKey = (sourceId: string, query: ResearchQuery): string => {
  const term = query.term.trim().toLowerCase();
  const brand = (query.brand ?? '').trim().toLowerCase();
  const region = (query.region ?? '').trim();
  return `product-research:${sourceId}:${term}:${brand}:${query.ean ?? ''}:${region}`;
};
