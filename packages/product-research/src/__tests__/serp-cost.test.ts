import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../connectors/registry';
import { createSerpConnector } from '../connectors/serp';
import type { ConnectorContext } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import { defaultResearchConfig } from '../ports';
import type { ResearchDeps } from '../ports';
import type { ResearchQuery, SourceRecord } from '../types';
import { PT_BR_MARKET_VOCABULARY } from '../normalize/pt-BR';

/**
 * Cost control for the paid SERP source (FUT-418). The reference system
 * intended a 24h result cache and shipped an ~86-SECOND one by accident, so
 * the TTL here is asserted explicitly in milliseconds — a unit slip (seconds
 * vs ms) must fail a test, not a monthly invoice.
 */

const DAY_MS = 86_400_000;

const SERP_SOURCE: SourceRecord = {
  id: 'serp-1',
  clientId: 'tenant-1',
  type: 'SERP',
  name: 'Busca web',
  config: {},
  enabled: true,
  status: 'ACTIVE',
};

const QUERY: ResearchQuery = {
  term: 'Guaraná Antarctica 350ml',
  quantity: 12,
  region: '01310-100',
};

const RESPONSE = {
  shopping_results: [
    {
      title: 'Refrigerante Guaraná Antarctica Lata 350ml',
      seller: 'Atacadão',
      price: 'R$ 3,49',
      extracted_price: 3.49,
      product_link: 'https://www.google.com.br/shopping/product/1',
    },
  ],
};

interface Harness {
  deps: ResearchDeps;
  store: InMemoryResearchStore;
  registry: ConnectorRegistry;
  vendorCalls: { count: number };
  setTtls: number[];
  clock: { nowMs: number };
}

const makeHarness = (budget = new FixedBudget(10)): Harness => {
  const clock = { nowMs: Date.parse('2026-07-29T12:00:00Z') };
  const vendorCalls = { count: 0 };
  const setTtls: number[] = [];

  const store = new InMemoryResearchStore();
  store.sources = [SERP_SOURCE];

  const inner = new InMemoryCache(() => clock.nowMs);
  const deps: ResearchDeps = {
    store,
    cache: {
      get: (key) => inner.get(key),
      set: (key, value, ttlSeconds) => {
        setTtls.push(ttlSeconds);
        return inner.set(key, value, ttlSeconds);
      },
    },
    budget,
    logger: silentLogger,
    diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
    now: () => new Date(clock.nowMs),
  };

  const registry = new ConnectorRegistry().register(
    createSerpConnector({ getApiKey: () => 'test-key', vocabulary: PT_BR_MARKET_VOCABULARY }),
  );
  return { deps, store, registry, vendorCalls, setTtls, clock };
};

const ctxFor = (harness: Harness): ConnectorContext => ({
  logger: silentLogger,
  diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  fetchJson: () => {
    harness.vendorCalls.count += 1;
    return Promise.resolve(RESPONSE);
  },
});

const run = (harness: Harness, requestId: string) =>
  runResearch(harness.deps, harness.registry, ctxFor(harness), {
    clientId: 'tenant-1',
    requestId,
    query: QUERY,
  });

describe('SERP cost control', () => {
  it('caches for exactly 24 hours — 86_400_000 ms, not ~86 seconds', async () => {
    const harness = makeHarness();

    await run(harness, 'req-1');
    expect(harness.vendorCalls.count).toBe(1);
    // THE assertion this ticket exists for: the TTL handed to the cache, in
    // milliseconds. 86_400 would be the reference system's 86-second bug.
    expect(harness.setTtls).toEqual([DAY_MS / 1000]);
    expect(harness.setTtls[0]! * 1000).toBe(86_400_000);
    expect(defaultResearchConfig.ttlSeconds * 1000).toBe(86_400_000);

    // One millisecond before expiry: still zero additional vendor calls.
    harness.clock.nowMs += DAY_MS - 1;
    const cached = await run(harness, 'req-2');
    expect(harness.vendorCalls.count).toBe(1);
    expect(cached.sourceStats[0]).toMatchObject({ status: 'CACHED', costUnits: 0 });
    expect(cached.offers).toHaveLength(1);

    // At expiry the next run pays for a fresh vendor call.
    harness.clock.nowMs += 1;
    await run(harness, 'req-3');
    expect(harness.vendorCalls.count).toBe(2);
  });

  it('records the per-run cost metric on the source stat', async () => {
    const harness = makeHarness();
    const first = await run(harness, 'req-1');
    expect(first.sourceStats[0]).toMatchObject({ status: 'OK', costUnits: 1 });

    const store = harness.store;
    expect(store.runs[0]?.sourceStats[0]?.costUnits).toBe(1);
  });

  it('skips the vendor entirely when the budget refuses, with a visible stat', async () => {
    const harness = makeHarness(new FixedBudget(0));
    const result = await run(harness, 'req-1');

    expect(harness.vendorCalls.count).toBe(0);
    expect(result.sourceStats[0]).toMatchObject({
      status: 'BUDGET_EXCEEDED',
      costUnits: 0,
      offerCount: 0,
    });
    expect(result.status).toBe('COMPLETED');
  });

  it('runs on after a budget refusal — free sources still answer', async () => {
    const harness = makeHarness(new FixedBudget(0));
    harness.store.sources = [
      SERP_SOURCE,
      { ...SERP_SOURCE, id: 'vtex-1', type: 'VTEX', name: 'Giga' },
    ];
    harness.registry.register({
      type: 'VTEX',
      search: () =>
        Promise.resolve({
          ok: true as const,
          offers: [
            {
              supplierName: 'Giga',
              title: 'Guaraná Antarctica Lata 350ml',
              priceCents: 359,
              currency: 'BRL',
            },
          ],
        }),
    });

    const result = await run(harness, 'req-1');
    expect(result.status).toBe('COMPLETED');
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.sourceType).toBe('VTEX');
    expect(result.sourceStats.find((stat) => stat.type === 'SERP')?.status).toBe(
      'BUDGET_EXCEEDED',
    );
    // A free source carries no cost metric at all.
    expect(result.sourceStats.find((stat) => stat.type === 'VTEX')?.costUnits).toBeUndefined();
  });
});
