import type { ConnectorContext, ConnectorResult, PriceSourceConnector } from '../connectors/types';
import { ConnectorRegistry } from '../connectors/registry';
import { cacheKey } from '../ports';
import type { ResearchConfig, ResearchDeps } from '../ports';
import { pacedContext } from './rate-limit';
import { budgetedContext, hitCeiling, sourceCeilingError, sourceDeadlineAt } from './source-budget';
import type { RawOffer, ResearchQuery, SourceRecord, SourceStat } from '../types';

/**
 * Everything about asking ONE source: the cache envelope, the paid-budget
 * gate, the connector's never-throw seam, the degradation/recovery marks and
 * the stat assembly. Split out of `run-research.ts` (FUT-519) — that file sat
 * 8 lines under the 400-line gate, so the incremental-persistence work could
 * not land in place. Same cut as `vtex-parse`/`vtex-regions`/`vtex-validate`:
 * the run LIFECYCLE stays in `run-research.ts`, one source's ANSWER lives here.
 */

/** One source's settled answer: its stat, its raw offers, and itself. */
export interface SourceOutcome {
  stat: SourceStat;
  offers: RawOffer[];
  source: SourceRecord;
}

/**
 * One source's cached answer. An ENVELOPE since FUT-495, because a per-source
 * fact that is not a property of any offer — "the store does not deliver to
 * this region", the caveat a ZERO-offer not-served answer must keep — cannot
 * ride the offer array. A legacy entry (a bare array) still reads: the flag is
 * simply absent, exactly as it was before.
 */
interface CachedAnswer {
  offers: RawOffer[];
  outsideDeliveryArea?: boolean;
  /**
   * This answer was cut short by the per-source ceiling (FUT-516) — on the
   * ENVELOPE for the same reason as the flag above: a truncated answer with
   * zero offers has no offer to carry it, and that is precisely the case the
   * caveat matters for.
   */
  truncated?: boolean;
}

/** A cached answer, or null on miss. A corrupt entry is a miss, not a failure. */
const readCachedAnswer = async (deps: ResearchDeps, key: string): Promise<CachedAnswer | null> => {
  const cached = await deps.cache.get(key);
  if (cached === null) return null;
  try {
    const parsed = JSON.parse(cached) as unknown;
    if (Array.isArray(parsed)) return { offers: parsed as RawOffer[] };
    const envelope = parsed as CachedAnswer | null;
    return Array.isArray(envelope?.offers) ? envelope : null;
  } catch {
    return null;
  }
};

/**
 * Store one source's answer. A TRUNCATED answer gets the short TTL: it is a
 * partial answer, and pinning it for the 24h default would let one unlucky
 * minute be the tenant's price list for a day. `Math.min` rather than the short
 * value outright, so a host that configured a ttl BELOW the truncated one still
 * gets the shorter of the two.
 */
const writeCachedAnswer = (
  deps: ResearchDeps,
  key: string,
  answer: CachedAnswer,
  config: ResearchConfig,
): Promise<void> =>
  deps.cache.set(
    key,
    JSON.stringify(answer),
    answer.truncated === true
      ? Math.min(config.ttlSeconds, config.truncatedTtlSeconds)
      : config.ttlSeconds,
  );

/**
 * Reserve one paid call. Connectors riding one paid vendor account share one
 * spend pool (SERP + AMAZON → SEARCHAPI), so one cap covers the whole invoice.
 */
const consumePaidBudget = (
  deps: ResearchDeps,
  source: SourceRecord,
  connector: PriceSourceConnector,
): Promise<boolean> =>
  deps.budget.tryConsume({
    clientId: source.clientId,
    sourceType: connector.budgetScope ?? source.type,
    units: 1,
  });

/** Connector search with the never-throw contract enforced at the seam. */
const searchViaConnector = async (
  connector: NonNullable<ReturnType<ConnectorRegistry['get']>>,
  query: ResearchQuery,
  source: SourceRecord,
  ctx: ConnectorContext,
): Promise<ConnectorResult> => {
  try {
    return await connector.search(query, source, ctx);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

const clockOf = (deps: ResearchDeps): (() => Date) => deps.now ?? (() => new Date());

/**
 * Tell the host a source just failed — AFTER the durable mark, and swallowing
 * observer errors: a dead notification transport costs an alert, never a run.
 * `previousStatus` is the status the run loaded, so the host can alert only on
 * the ACTIVE → DEGRADED edge instead of once per run while a store is down.
 */
const emitSourceDegraded = async (
  deps: ResearchDeps,
  source: SourceRecord,
  previousStatus: SourceRecord['status'],
  error: string,
  at: Date,
): Promise<void> => {
  if (!deps.events) return;
  try {
    await deps.events.sourceDegraded({
      sourceId: source.id,
      clientId: source.clientId,
      sourceType: source.type,
      sourceName: source.name,
      previousStatus,
      error,
      at,
    });
  } catch (eventError) {
    deps.logger.warn('source-degraded event handler failed', {
      sourceId: source.id,
      error: eventError instanceof Error ? eventError.message : String(eventError),
    });
  }
};

/** Durable mark first, host event second (never the other way around). */
const noteSourceDegraded = async (
  deps: ResearchDeps,
  source: SourceRecord,
  error: string,
): Promise<void> => {
  const at = clockOf(deps)();
  // Snapshot BEFORE the mark: a store may hand out live references, and the
  // event's whole point is the status the source held going into this run.
  const previousStatus = source.status;
  await deps.store.markSourceDegraded({ sourceId: source.id, error, at });
  await emitSourceDegraded(deps, source, previousStatus, error, at);
};

/**
 * A live answer from a source marked DEGRADED is the recovery: clear the mark
 * so the "results may be incomplete" warning stops and the host's degradation
 * alert can fire again on the NEXT genuine outage.
 */
const noteSourceRecovered = async (deps: ResearchDeps, source: SourceRecord): Promise<void> => {
  if (source.status !== 'DEGRADED') return;
  await deps.store.markSourceRecovered?.({ sourceId: source.id, at: clockOf(deps)() });
};

/** What one settled source contributes, beyond its status and its offers. */
interface SettleExtras {
  error?: string;
  /**
   * The source's own claim that these prices are another region's (FUT-495).
   * Undefined means "no claim" and the offers decide — which is what a CACHED
   * legacy entry and any connector that only flags offers rely on.
   */
  outsideDeliveryArea?: boolean;
  /** This source ran out of its wall-clock ceiling (FUT-516). */
  truncated?: boolean;
}

const settleSource = (
  input: {
    source: SourceRecord;
    status: SourceStat['status'];
    offers: RawOffer[];
    ms: number;
    costUnits?: number;
  } & SettleExtras,
): SourceOutcome => {
  const { source, offers } = input;
  // FUT-491 derived this from the offers alone, which reports NO caveat for the
  // one case that needs it most: a store that does not deliver here and whose
  // default-region catalog matched nothing. The connector's own signal wins;
  // the offer-derived reading stays as the fallback (cached answers, and
  // connectors that flag offers without declaring a per-source verdict).
  const outsideArea =
    input.outsideDeliveryArea ?? offers.some((offer) => offer.outsideDeliveryArea === true);
  return {
    source,
    offers,
    stat: {
      sourceId: source.id,
      type: source.type,
      name: source.name,
      status: input.status,
      offerCount: offers.length,
      ms: input.ms,
      error: input.error,
      costUnits: input.costUnits,
      outsideDeliveryArea: outsideArea ? true : undefined,
      truncated: input.truncated,
    },
  };
};

/** `querySource`'s own closure over the stat assembly, passed to the settler. */
type FinishSource = (
  status: SourceStat['status'],
  offers: RawOffer[],
  extras?: SettleExtras,
) => SourceOutcome;

/**
 * What one LIVE connector answer settles to, once the ceiling verdict is in.
 * Split from `querySource` at an honest seam — everything above decides whether
 * to ask a source at all, everything here reads what came back — which is also
 * what keeps both sides inside the per-function size and complexity gates.
 */
const settleLiveAnswer = async (
  input: {
    deps: ResearchDeps;
    source: SourceRecord;
    config: ResearchConfig;
    key: string;
    useCache: boolean;
    result: ConnectorResult;
    /** `true` when the per-source ceiling was already spent (FUT-516). */
    truncated: boolean | undefined;
  },
  finish: FinishSource,
): Promise<SourceOutcome> => {
  const { deps, source, config, key, useCache, result, truncated } = input;
  if (!result.ok) {
    // A source WE cut short is NOT a source that failed, so it never degrades:
    // `markSourceDegraded` latches the row and fans a notification out to every
    // research-permission holder, and what we actually observed is our own
    // fan-out running out of time. The connector's own error is dropped for the
    // same reason — it blames the store for a request we stopped sending.
    if (truncated === true) {
      return finish('FAILED', [], {
        truncated,
        error: sourceCeilingError(deps.diagnostics.budget),
      });
    }
    await noteSourceDegraded(deps, source, result.error);
    return finish('FAILED', [], { error: result.error });
  }
  // Recovery clears on a truncated OK too: the store demonstrably answered its
  // catalog tier. Demanding a perfect run to clear the latch would pin a
  // chronically-slow-but-working store at DEGRADED forever.
  await noteSourceRecovered(deps, source);
  if (useCache) {
    await writeCachedAnswer(
      deps,
      key,
      { offers: result.offers, outsideDeliveryArea: result.outsideDeliveryArea, truncated },
      config,
    );
  }
  return finish('OK', result.offers, {
    truncated,
    outsideDeliveryArea: result.outsideDeliveryArea,
  });
};

export const querySource = async (
  source: SourceRecord,
  query: ResearchQuery,
  deps: ResearchDeps,
  config: ResearchConfig,
  registry: ConnectorRegistry,
  ctx: ConnectorContext,
): Promise<SourceOutcome> => {
  const started = Date.now();
  const paid = config.paidSourceTypes.includes(source.type);
  // The per-run cost metric: paid sources report their budget units even when
  // the answer was free (cache/budget gate → 0), free sources report nothing.
  let costUnits = paid ? 0 : undefined;
  const finish = (
    status: SourceStat['status'],
    offers: RawOffer[],
    extras: SettleExtras = {},
  ): SourceOutcome =>
    settleSource({ source, status, offers, ms: Date.now() - started, costUnits, ...extras });

  const connector = registry.get(source.type);
  if (!connector) {
    return finish('SKIPPED', [], { error: `no connector registered for ${source.type}` });
  }

  // Local-data connectors (MANUAL) opt out of the cache entirely: reading
  // their store costs nothing and caching would hide a fresh re-import for a
  // whole TTL.
  const useCache = connector.cacheable !== false;
  const key = cacheKey(source.id, query);
  if (useCache) {
    const cached = await readCachedAnswer(deps, key);
    if (cached !== null) {
      // The flag rides the envelope, so a cache HIT on a truncated answer is
      // still reported as truncated — which is what lets the job's three
      // attempts reuse it (they cost nothing) without the second and third
      // silently presenting a cut answer as a complete one.
      return finish('CACHED', cached.offers, {
        outsideDeliveryArea: cached.outsideDeliveryArea,
        truncated: cached.truncated,
      });
    }
  }

  if (paid) {
    const allowed = await consumePaidBudget(deps, source, connector);
    if (!allowed) return finish('BUDGET_EXCEEDED', []);
    costUnits = 1;
  }

  // Both wrappers sit on the connector's fetch path, AFTER the cache and budget
  // gates so an answered source spends neither a limiter slot nor a second of
  // its ceiling. Pacing first, the ceiling outermost: a request still waiting
  // for a limiter slot is a request that has not been sent, and it must be
  // refused rather than sent late.
  //
  // The deadline is computed from `started` — `Date.now()`, deliberately NOT
  // `deps.now`. The transport reads the real clock, so a deadline minted on a
  // fake one would be an instant the host cannot honour (and a fake-clock test
  // would "prove" a ceiling that never fires). Do not "fix" this to `deps.now`.
  const deadlineAt = sourceDeadlineAt(started, config.sourceBudgetMs);
  const pacedCtx = budgetedContext(
    pacedContext(ctx, deps.rateLimiter, source.config),
    deadlineAt,
  );
  const result = await searchViaConnector(connector, query, source, pacedCtx);

  return settleLiveAnswer(
    {
      deps,
      source,
      config,
      key,
      useCache,
      result,
      truncated: hitCeiling(deadlineAt) ? true : undefined,
    },
    finish,
  );
};
