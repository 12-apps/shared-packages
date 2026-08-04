import type { BudgetPort, CachePort, LoggerPort, RateLimiterPort, ResearchStore } from './ports';
import type { RunStatus, ScoredOffer, SourceRecord, SourceStat } from './types';

/**
 * In-memory adapters: the reference "second host". They make the engine
 * runnable with zero infrastructure — unit tests, Storybook mocks, and the
 * proof that mounting the package needs nothing Paladira-specific.
 */

interface StoredRun {
  id: string;
  clientId: string;
  requestId: string;
  status: RunStatus;
  sourceStats: SourceStat[];
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export class InMemoryResearchStore implements ResearchStore {
  sources: SourceRecord[] = [];
  runs: StoredRun[] = [];
  offers: (ScoredOffer & { clientId: string; runId: string })[] = [];
  degraded: { sourceId: string; error: string; at: Date }[] = [];
  recovered: { sourceId: string; at: Date }[] = [];
  private nextRunId = 1;

  listEnabledSources(clientId: string): Promise<SourceRecord[]> {
    return Promise.resolve(
      this.sources.filter((source) => source.clientId === clientId && source.enabled),
    );
  }

  createRun(input: { clientId: string; requestId: string }): Promise<{ id: string }> {
    const run: StoredRun = {
      id: `run-${this.nextRunId++}`,
      clientId: input.clientId,
      requestId: input.requestId,
      status: 'PENDING',
      sourceStats: [],
    };
    this.runs.push(run);
    return Promise.resolve({ id: run.id });
  }

  updateRun(input: {
    runId: string;
    status: RunStatus;
    sourceStats?: SourceStat[];
    error?: string;
    startedAt?: Date;
    finishedAt?: Date;
  }): Promise<void> {
    const run = this.runs.find((candidate) => candidate.id === input.runId);
    if (run) {
      run.status = input.status;
      if (input.sourceStats) run.sourceStats = input.sourceStats;
      if (input.error !== undefined) run.error = input.error;
      if (input.startedAt) run.startedAt = input.startedAt;
      if (input.finishedAt) run.finishedAt = input.finishedAt;
    }
    return Promise.resolve();
  }

  appendRunSourceStat(input: { runId: string; stat: SourceStat }): Promise<void> {
    const run = this.runs.find((candidate) => candidate.id === input.runId);
    if (run) {
      // Replace-or-append by sourceId: a retried settle must never duplicate.
      const index = run.sourceStats.findIndex((stat) => stat.sourceId === input.stat.sourceId);
      if (index >= 0) run.sourceStats[index] = input.stat;
      else run.sourceStats.push(input.stat);
    }
    return Promise.resolve();
  }

  appendRunOffers(input: {
    clientId: string;
    runId: string;
    offers: ScoredOffer[];
  }): Promise<void> {
    // `rank: undefined` on purpose (the port's contract): the run's order is
    // global, so a per-source rank here would sort this batch above every
    // later source's cheaper offers under the host's `rank asc NULLS LAST`.
    this.offers.push(
      ...input.offers.map((offer) => ({
        ...offer,
        rank: undefined,
        clientId: input.clientId,
        runId: input.runId,
      })),
    );
    return Promise.resolve();
  }

  insertOffers(input: { clientId: string; runId: string; offers: ScoredOffer[] }): Promise<void> {
    // REPLACE, not append (FUT-519): this is the run's authoritative set, and
    // whatever `appendRunOffers` wrote mid-run is pre-rank, pre-dedupe.
    this.offers = this.offers.filter((offer) => offer.runId !== input.runId);
    this.offers.push(
      ...input.offers.map((offer) => ({ ...offer, clientId: input.clientId, runId: input.runId })),
    );
    return Promise.resolve();
  }

  markSourceDegraded(input: { sourceId: string; error: string; at: Date }): Promise<void> {
    this.degraded.push(input);
    const source = this.sources.find((candidate) => candidate.id === input.sourceId);
    if (source) source.status = 'DEGRADED';
    return Promise.resolve();
  }

  markSourceRecovered(input: { sourceId: string; at: Date }): Promise<void> {
    this.recovered.push(input);
    const source = this.sources.find((candidate) => candidate.id === input.sourceId);
    if (source) source.status = 'ACTIVE';
    return Promise.resolve();
  }
}

export class InMemoryCache implements CachePort {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= this.now()) return Promise.resolve(null);
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }
}

/**
 * Bounded pacing: a limiter must delay a run, never wedge it. A burst that
 * would queue an acquire further out than this goes through at the bound
 * instead — the same rail a shared (e.g. Redis) limiter enforces.
 */
const MAX_WAIT_MS = 15_000;

/**
 * Per-process rate limiter: spaces requests to one key `1000/ratePerSecond`
 * milliseconds apart (the first goes through immediately), waiting at most
 * `MAX_WAIT_MS` per acquire so a large burst cannot stack an unbounded tail of
 * sleeping callers. Correct within one process — the reference adapter for
 * tests and for hosts without a shared backend; a multi-worker host should
 * bind a shared (e.g. Redis) limiter. Clock and sleep are injectable so tests
 * never wait on real time.
 */
export class InMemoryRateLimiter implements RateLimiterPort {
  private readonly nextSlotAt = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async acquire(key: string, ratePerSecond: number): Promise<void> {
    const interval = 1000 / Math.max(ratePerSecond, 0.001);
    const now = this.now();
    // Capping the slot (not just the sleep) also stops `nextSlotAt` drifting
    // arbitrarily far into the future during a burst.
    const slot = Math.min(Math.max(this.nextSlotAt.get(key) ?? 0, now), now + MAX_WAIT_MS);
    this.nextSlotAt.set(key, slot + interval);
    if (slot > now) await this.sleep(slot - now);
  }
}

/** Budget with a fixed allowance per (client, source type). */
export class FixedBudget implements BudgetPort {
  private readonly spent = new Map<string, number>();

  constructor(private readonly allowance: number) {}

  tryConsume(input: { clientId: string; sourceType: string; units: number }): Promise<boolean> {
    const key = `${input.clientId}:${input.sourceType}`;
    const used = this.spent.get(key) ?? 0;
    if (used + input.units > this.allowance) return Promise.resolve(false);
    this.spent.set(key, used + input.units);
    return Promise.resolve(true);
  }
}

export const silentLogger: LoggerPort = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
