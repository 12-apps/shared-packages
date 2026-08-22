import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../connectors/registry';
import type { ConnectorContext, PriceSourceConnector } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import { decodeResearchRunWireEvent, toResearchRunWireEvent } from '../pipeline/progress-wire';
import type { ResearchDeps, ResearchRunProgressEvent } from '../ports';
import type { RawOffer, SourceRecord } from '../types';

/**
 * FUT-439: the pipeline's per-source progress seam. Order, payloads, the
 * incremental stat write, the no-op default, and the wire round trip.
 */

const CLIENT = 'tenant-1';

const source = (overrides: Partial<SourceRecord>): SourceRecord => ({
  id: 'src-1',
  clientId: CLIENT,
  type: 'VTEX',
  name: 'Giga',
  config: {},
  enabled: true,
  status: 'ACTIVE',
  ...overrides,
});

const OFFER: RawOffer = {
  supplierName: 'Giga',
  title: 'Coca-Cola Lata 350ml',
  priceCents: 429,
  availability: 'IN_STOCK',
};

const ctx: ConnectorContext = { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS };

interface Harness {
  store: InMemoryResearchStore;
  deps: ResearchDeps;
  events: ResearchRunProgressEvent[];
}

const makeHarness = (sources: SourceRecord[], budget?: FixedBudget): Harness => {
  const harnessStore = new InMemoryResearchStore();
  harnessStore.sources = sources;
  const observed: ResearchRunProgressEvent[] = [];
  const harnessDeps: ResearchDeps = {
    store: harnessStore,
    cache: new InMemoryCache(),
    budget: budget ?? new FixedBudget(10),
    logger: silentLogger,
    diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
    events: {
      sourceDegraded: () => undefined,
      runProgress: (event) => {
        observed.push(event);
      },
    },
  };
  return { store: harnessStore, deps: harnessDeps, events: observed };
};

const query = { term: 'Coca-Cola Lata 350ml', brand: 'Coca-Cola', quantity: 1 };

describe('run progress emission', () => {
  it('emits started → settled per source and run-finished last, with full payloads', async () => {
    const { deps, events } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: true as const, offers: [OFFER] }),
    });

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });

    expect(events.map((event) => event.kind)).toEqual([
      'source-started',
      'source-settled',
      'run-finished',
    ]);
    expect(events[0]).toMatchObject({
      clientId: CLIENT,
      requestId: 'req-1',
      runId: result.runId,
      sourceId: 'src-1',
      sourceType: 'VTEX',
      sourceName: 'Giga',
    });
    expect(events[1]).toMatchObject({
      runId: result.runId,
      stat: { sourceId: 'src-1', status: 'OK', offerCount: 1 },
    });
    expect(events[2]).toMatchObject({ runId: result.runId, status: 'COMPLETED' });
  });

  it('reports a fast source settled while a slow one is still pending', async () => {
    const { store, deps, events } = makeHarness([
      source({ id: 'src-fast', name: 'Rápida' }),
      source({ id: 'src-slow', name: 'Lenta', type: 'MANUAL' }),
    ]);
    const gate: { release: () => void } = { release: () => undefined };
    const slowAnswer = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const registry = new ConnectorRegistry()
      .register({
        type: 'VTEX',
        search: () => Promise.resolve({ ok: true as const, offers: [OFFER] }),
      })
      .register({
        type: 'MANUAL',
        cacheable: false,
        search: async () => {
          await slowAnswer;
          return { ok: true as const, offers: [] };
        },
      } satisfies PriceSourceConnector);

    const running = runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });

    // The fast source's settle is observable BEFORE the slow source answers —
    // the whole point of FUT-439 (the audited FUT-420 gap).
    await expect.poll(() =>
      events.some((event) => event.kind === 'source-settled'),
    ).toBe(true);
    const settledEarly = events.filter((event) => event.kind === 'source-settled');
    expect(settledEarly).toHaveLength(1);
    expect(settledEarly[0]).toMatchObject({ stat: { sourceId: 'src-fast', status: 'OK' } });
    // ...and it is already durable: the run row carries the partial stat.
    expect(store.runs[0]?.sourceStats.map((stat) => stat.sourceId)).toEqual(['src-fast']);
    expect(store.runs[0]?.status).toBe('RUNNING');

    gate.release();
    const result = await running;
    expect(result.status).toBe('COMPLETED');
    expect(events.filter((event) => event.kind === 'source-settled')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', status: 'COMPLETED' });
    expect(store.runs[0]?.sourceStats).toHaveLength(2);
  });

  it('carries degraded and budget-refused outcomes in the settled stat', async () => {
    // Zero allowance: the paid source is refused before its connector runs.
    const { deps, events } = makeHarness(
      [
        source({ id: 'src-down', name: 'Fora do ar' }),
        source({ id: 'src-paid', name: 'Paga', type: 'SERP' }),
      ],
      new FixedBudget(0),
    );
    const registry = new ConnectorRegistry()
      .register({
        type: 'VTEX',
        search: () => Promise.resolve({ ok: false as const, error: 'HTTP 503' }),
      })
      .register({
        type: 'SERP',
        search: () => Promise.resolve({ ok: true as const, offers: [] }),
      });

    await runResearch(deps, registry, ctx, { clientId: CLIENT, requestId: 'req-1', query });

    const settled = events.filter(
      (event): event is Extract<ResearchRunProgressEvent, { kind: 'source-settled' }> =>
        event.kind === 'source-settled',
    );
    const bySource = new Map(settled.map((event) => [event.stat.sourceId, event.stat]));
    expect(bySource.get('src-down')).toMatchObject({ status: 'FAILED', error: 'HTTP 503' });
    expect(bySource.get('src-paid')).toMatchObject({ status: 'BUDGET_EXCEEDED', offerCount: 0 });
  });

  it('emits run-finished FAILED after the terminal write when the run throws', async () => {
    const { store, deps, events } = makeHarness([source({})]);
    Object.assign(store, {
      listEnabledSources: () => Promise.reject(new Error('db fora')),
    });
    const registry = new ConnectorRegistry();

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });

    expect(result.status).toBe('FAILED');
    expect(events.map((event) => event.kind)).toEqual(['run-finished']);
    expect(events[0]).toMatchObject({ status: 'FAILED', runId: result.runId });
    // Durable first: by emission time the run row is already FAILED.
    expect(store.runs[0]?.status).toBe('FAILED');
  });

  it('swallows observer failures and runs unchanged without the port (no-op default)', async () => {
    const throwing = makeHarness([source({})]);
    throwing.deps.events = {
      sourceDegraded: () => undefined,
      runProgress: () => {
        throw new Error('observer morto');
      },
    };
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: true as const, offers: [OFFER] }),
    });
    await expect(
      runResearch(throwing.deps, registry, ctx, { clientId: CLIENT, requestId: 'req-1', query }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });

    const portless = makeHarness([source({})]);
    portless.deps.events = undefined;
    await expect(
      runResearch(portless.deps, registry, ctx, { clientId: CLIENT, requestId: 'req-2', query }),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });
});

describe('run progress wire vocabulary', () => {
  const at = new Date('2026-07-30T12:00:00Z');
  const scope = { clientId: CLIENT, requestId: 'req-1', runId: 'run-1' };

  it('round-trips every event kind through encode → decode', () => {
    const stat = {
      sourceId: 'src-1',
      type: 'VTEX',
      name: 'Giga',
      status: 'OK' as const,
      offerCount: 3,
      ms: 120,
    };
    const events: ResearchRunProgressEvent[] = [
      { kind: 'source-started', ...scope, sourceId: 'src-1', sourceType: 'VTEX', sourceName: 'Giga', at },
      { kind: 'source-settled', ...scope, stat, at },
      { kind: 'run-finished', ...scope, status: 'COMPLETED', at },
    ];

    for (const event of events) {
      const wire = toResearchRunWireEvent(event);
      // Simulate the channel: payloads travel as JSON.
      const decoded = decodeResearchRunWireEvent(JSON.parse(JSON.stringify(wire)));
      expect(decoded).toEqual(wire);
      expect(decoded?.data).toMatchObject({ runId: 'run-1', requestId: 'req-1' });
    }
  });

  it('refuses foreign event types and malformed payloads', () => {
    expect(decodeResearchRunWireEvent({ type: 'kitchen.ticket.updated', data: {} })).toBeNull();
    expect(
      decodeResearchRunWireEvent({ type: 'research-run.source-settled', data: { runId: 'r' } }),
    ).toBeNull();
    expect(decodeResearchRunWireEvent({ type: 'research-run.finished', data: null })).toBeNull();
  });
});
