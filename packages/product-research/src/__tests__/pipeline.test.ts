import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorRegistry } from '../connectors/registry';
import type { ConnectorContext, PriceSourceConnector } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import { sourceCeilingError } from '../pipeline/source-budget';
import { cacheKey } from '../ports';
import type { BudgetPort, ResearchDeps, SourceDegradedEvent } from '../ports';
import type { RawOffer, SourceRecord } from '../types';

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

const stubConnector = (
  type: string,
  offers: RawOffer[],
  calls?: { count: number },
): PriceSourceConnector => ({
  type,
  search: () => {
    if (calls) calls.count += 1;
    return Promise.resolve({ ok: true as const, offers });
  },
});

const ctx: ConnectorContext = { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS };

const makeHarness = (
  sources: SourceRecord[],
  budget: BudgetPort = new FixedBudget(10),
): { store: InMemoryResearchStore; deps: ResearchDeps } => {
  const store = new InMemoryResearchStore();
  store.sources = sources;
  return {
    store,
    deps: { store, cache: new InMemoryCache(), budget, logger: silentLogger, diagnostics: PT_BR_RESEARCH_DIAGNOSTICS },
  };
};

describe('runResearch', () => {
  it('persists ranked offers and drops low-relevance ones', async () => {
    const { store, deps } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [
        {
          supplierName: 'Giga',
          title: 'Refrigerante Coca-Cola Lata 350ml',
          priceCents: 429,
          availability: 'IN_STOCK',
        },
        {
          supplierName: 'Giga',
          title: 'Refrigerante Coca-Cola Pet 2,5l',
          priceCents: 1199,
          availability: 'IN_STOCK',
        },
        { supplierName: 'Giga', title: 'Coca-Cola sem preço' },
      ]),
    );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', brand: 'Coca-Cola', quantity: 24 },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.title).toContain('350ml');
    expect(result.offers[0]?.rank).toBe(1);
    expect(store.offers).toHaveLength(1);
    expect(store.runs[0]?.status).toBe('COMPLETED');
    expect(store.runs[0]?.sourceStats[0]).toMatchObject({ status: 'OK', offerCount: 3 });
  });

  it('keeps an exact-EAN offer even when its title matches nothing', async () => {
    const { deps } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [
        {
          supplierName: 'Giga',
          title: 'Refri original embalagem promocional',
          ean: '7894900010015',
          priceCents: 429,
        },
      ]),
    );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', ean: '7894900010015', quantity: 1 },
    });

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.relevanceScore).toBe(1);
  });

  it('serves the second identical run from cache without calling the connector', async () => {
    const { deps } = makeHarness([source({})]);
    const calls = { count: 0 };
    const registry = new ConnectorRegistry().register(
      stubConnector(
        'VTEX',
        [{ supplierName: 'Giga', title: 'Coca-Cola Lata 350ml', priceCents: 429 }],
        calls,
      ),
    );
    const input = {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    };

    await runResearch(deps, registry, ctx, input);
    const second = await runResearch(deps, registry, ctx, input);

    expect(calls.count).toBe(1);
    expect(second.sourceStats[0]?.status).toBe('CACHED');
    expect(second.offers).toHaveLength(1);
  });

  it('skips paid sources when the budget is exhausted, visibly', async () => {
    const { deps } = makeHarness(
      [source({ id: 'serp-1', type: 'SERP', name: 'Google BR' })],
      new FixedBudget(0),
    );
    const registry = new ConnectorRegistry().register(
      stubConnector('SERP', [
        { supplierName: 'Loja', title: 'Coca-Cola Lata 350ml', priceCents: 400 },
      ]),
    );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.offers).toHaveLength(0);
    expect(result.sourceStats[0]?.status).toBe('BUDGET_EXCEEDED');
  });

  it('marks a failing source degraded and completes on the others', async () => {
    const { store, deps } = makeHarness([
      source({ id: 'ok-1', name: 'Loja OK' }),
      source({ id: 'down-1', name: 'Loja fora', type: 'MERCADO_LIVRE' }),
    ]);
    const registry = new ConnectorRegistry()
      .register(
        stubConnector('VTEX', [
          { supplierName: 'OK', title: 'Coca-Cola Lata 350ml', priceCents: 400 },
        ]),
      )
      .register({
        type: 'MERCADO_LIVRE',
        search: () => Promise.resolve({ ok: false as const, error: 'HTTP 503' }),
      });

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.offers).toHaveLength(1);
    const failed = result.sourceStats.find((stat) => stat.sourceId === 'down-1');
    expect(failed?.status).toBe('FAILED');
    expect(store.degraded).toHaveLength(1);
    expect(store.sources.find((candidate) => candidate.id === 'down-1')?.status).toBe('DEGRADED');
  });

  it('emits a source-degraded event to the host with the pre-run status', async () => {
    const { store, deps } = makeHarness([source({ id: 'down-1', name: 'Loja fora' })]);
    const events: SourceDegradedEvent[] = [];
    deps.events = {
      sourceDegraded: (event) => {
        events.push(event);
      },
    };
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: false as const, error: 'HTTP 503' }),
    });

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    });

    expect(result.status).toBe('COMPLETED');
    // The durable mark happens first; the event carries what the host needs
    // to notify without re-reading anything, including the ACTIVE edge.
    expect(store.degraded).toHaveLength(1);
    expect(events).toEqual([
      {
        sourceId: 'down-1',
        clientId: CLIENT,
        sourceType: 'VTEX',
        sourceName: 'Loja fora',
        previousStatus: 'ACTIVE',
        error: 'HTTP 503',
        at: expect.any(Date),
      },
    ]);
  });

  it('a healthy run emits no degradation event', async () => {
    const { deps } = makeHarness([source({})]);
    const events: SourceDegradedEvent[] = [];
    deps.events = {
      sourceDegraded: (event) => {
        events.push(event);
      },
    };
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [{ supplierName: 'Giga', title: 'Coca-Cola Lata 350ml', priceCents: 400 }]),
    );

    await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    });

    expect(events).toEqual([]);
  });

  it('a throwing event observer costs the alert, never the run', async () => {
    const { store, deps } = makeHarness([source({ id: 'down-1' })]);
    deps.events = {
      sourceDegraded: () => {
        throw new Error('notification transport down');
      },
    };
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: false as const, error: 'HTTP 503' }),
    });

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.sourceStats[0]?.status).toBe('FAILED');
    expect(store.degraded).toHaveLength(1);
  });

  it('flips a degraded source back to ACTIVE on a live answer, re-arming the alert edge', async () => {
    const { store, deps } = makeHarness([source({ id: 'back-1', status: 'DEGRADED' })]);
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [{ supplierName: 'Giga', title: 'Coca-Cola Lata 350ml', priceCents: 400 }]),
    );

    await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    });

    expect(store.recovered).toEqual([{ sourceId: 'back-1', at: expect.any(Date) }]);
    expect(store.sources[0]?.status).toBe('ACTIVE');
  });

  it('a cache hit proves nothing — it never recovers a degraded source', async () => {
    const harness = makeHarness([source({ id: 'cached-1', status: 'DEGRADED' })]);
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [{ supplierName: 'Giga', title: 'Coca-Cola Lata 350ml', priceCents: 400 }]),
    );
    const query = { term: 'Coca-Cola Lata 350ml', quantity: 1 };
    // A still-fresh answer cached before the source degraded: this run is
    // served from it and never contacts the store, so nothing was proven.
    await harness.deps.cache.set(
      cacheKey('cached-1', query),
      JSON.stringify([{ supplierName: 'Giga', title: 'Coca-Cola Lata 350ml', priceCents: 400 }]),
      3600,
    );

    const result = await runResearch(harness.deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });

    expect(result.sourceStats[0]?.status).toBe('CACHED');
    expect(harness.store.recovered).toEqual([]);
    expect(harness.store.sources[0]?.status).toBe('DEGRADED');
  });

  it('paces every connector fetch through the per-domain limiter', async () => {
    const { deps } = makeHarness([
      source({ config: { rateLimitPerSecond: 5 } }),
    ]);
    const acquired: { key: string; rate: number }[] = [];
    deps.rateLimiter = {
      acquire: (key, rate) => {
        acquired.push({ key, rate });
        return Promise.resolve();
      },
    };
    const fetching: PriceSourceConnector = {
      type: 'VTEX',
      search: async (_query, _source, connectorCtx) => {
        await connectorCtx.fetchJson('https://www.giga.com.vc/api/catalog_system/pub/products/search?ft=x');
        await connectorCtx.fetchJson('https://www.giga.com.vc/api/catalog_system/pub/products/search?ft=y');
        return { ok: true as const, offers: [] };
      },
    };

    await runResearch(deps, new ConnectorRegistry().register(fetching), ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    });

    // Both fetches took a slot for the store's domain, at the source's
    // configured override rather than the default.
    expect(acquired).toEqual([
      { key: 'www.giga.com.vc', rate: 5 },
      { key: 'www.giga.com.vc', rate: 5 },
    ]);
  });

  it('carries the out-of-area flag onto the offer AND the source stat (FUT-491)', async () => {
    const { store, deps } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [
        {
          supplierName: 'Apoio Entrega',
          title: 'Refrigerante Coca-Cola Lata 350ml',
          priceCents: 379,
          outsideDeliveryArea: true,
        },
      ]),
    );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 12, region: '31610-000' },
    });

    expect(result.offers[0]?.outsideDeliveryArea).toBe(true);
    expect(store.offers[0]?.outsideDeliveryArea).toBe(true);
    // The source SUCCEEDED — the status union is untouched and the caveat
    // rides beside it, on the persisted stat and on the returned one alike.
    expect(result.sourceStats[0]).toMatchObject({ status: 'OK', outsideDeliveryArea: true });
    expect(store.runs[0]?.sourceStats[0]).toMatchObject({ outsideDeliveryArea: true });
  });

  it('leaves the flag off an ordinary in-area run', async () => {
    const { deps } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [
        { supplierName: 'Giga', title: 'Coca-Cola Lata 350ml', priceCents: 379 },
      ]),
    );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1, region: '01310-100' },
    });

    expect(result.offers[0]?.outsideDeliveryArea).toBeUndefined();
    expect(result.sourceStats[0]?.outsideDeliveryArea).toBeUndefined();
  });

  it('a cached out-of-area answer keeps its caveat on the CACHED stat', async () => {
    const { deps } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [
        {
          supplierName: 'Apoio Entrega',
          title: 'Refrigerante Coca-Cola Lata 350ml',
          priceCents: 379,
          outsideDeliveryArea: true,
        },
      ]),
    );
    const input = {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 12, region: '31610-000' },
    };

    await runResearch(deps, registry, ctx, input);
    const second = await runResearch(deps, registry, ctx, input);

    // The flag survives the cache round-trip (it is part of the cached raw
    // offer), so a cached run cannot quietly drop the caveat.
    expect(second.sourceStats[0]).toMatchObject({ status: 'CACHED', outsideDeliveryArea: true });
    expect(second.offers[0]?.outsideDeliveryArea).toBe(true);
  });

  /**
   * FUT-495: the stat's caveat comes from the CONNECTOR's verdict, not from
   * `offers.some(flag)`. A store that does not deliver here and whose
   * default-region catalog matches nothing has no offer to carry the flag — and
   * that is precisely the run where the buyer must be told the store does not
   * serve them, instead of reading an ordinary empty answer.
   */
  it('flags a not-served source that returned ZERO offers', async () => {
    const { store, deps } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: true as const, offers: [], outsideDeliveryArea: true }),
    } satisfies PriceSourceConnector);

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 12, region: '20031-000' },
    });

    expect(result.sourceStats[0]).toMatchObject({
      status: 'OK',
      offerCount: 0,
      outsideDeliveryArea: true,
    });
    expect(store.runs[0]?.sourceStats[0]).toMatchObject({ outsideDeliveryArea: true });
  });

  it('keeps that zero-offer caveat across the cache round-trip', async () => {
    const { deps } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: true as const, offers: [], outsideDeliveryArea: true }),
    } satisfies PriceSourceConnector);
    const input = {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 12, region: '20031-000' },
    };

    await runResearch(deps, registry, ctx, input);
    const second = await runResearch(deps, registry, ctx, input);

    // With no offer to hang it on, the flag rides the cached ENVELOPE — a
    // cached run cannot quietly drop the one fact this answer carries.
    expect(second.sourceStats[0]).toMatchObject({
      status: 'CACHED',
      outsideDeliveryArea: true,
    });
  });

  it('still reads a legacy cache entry written as a bare offer array', async () => {
    const harness = makeHarness([source({ id: 'legacy-1' })]);
    const registry = new ConnectorRegistry().register(
      stubConnector('VTEX', [
        { supplierName: 'Giga', title: 'Refrigerante Coca-Cola Lata 350ml', priceCents: 400 },
      ]),
    );
    const query = { term: 'Refrigerante Coca-Cola Lata 350ml', quantity: 1 };
    await harness.deps.cache.set(
      cacheKey('legacy-1', query),
      JSON.stringify([
        {
          supplierName: 'Apoio',
          title: 'Refrigerante Coca-Cola Lata 350ml',
          priceCents: 379,
          outsideDeliveryArea: true,
        },
      ]),
      3600,
    );

    const result = await runResearch(harness.deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });

    // Pre-FUT-495 entries are arrays: they must still hit, and their per-offer
    // flags must still reach the stat.
    expect(result.sourceStats[0]).toMatchObject({ status: 'CACHED', outsideDeliveryArea: true });
    expect(result.offers[0]?.supplierName).toBe('Apoio');
  });

  it('ranks a fardo and a unit fairly across sources, charging whole packs', async () => {
    const { deps } = makeHarness([
      source({ id: 'a', name: 'Loja unidade' }),
      source({ id: 'b', name: 'Loja fardo', type: 'MERCADO_LIVRE' }),
    ]);
    const registry = new ConnectorRegistry()
      .register(
        stubConnector('VTEX', [
          { supplierName: 'Unidade', title: 'Coca-Cola Lata 350ml', priceCents: 359 },
        ]),
      )
      .register(
        stubConnector('MERCADO_LIVRE', [
          { supplierName: 'Fardo', title: 'Coca-Cola Lata 350ml Fardo 12x350ml', priceCents: 4200 },
        ]),
      );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 12 },
    });

    expect(result.offers[0]?.supplierName).toBe('Fardo');
    expect(result.offers[0]?.unitPriceCents).toBe(350);
    expect(result.offers[0]?.totalCents).toBe(4200);
    expect(result.offers[1]?.unitPriceCents).toBe(359);
    expect(result.offers[1]?.totalCents).toBe(4308);
  });

  /**
   * FUT-518: scoring used to do `raw.shippingCents ?? 0` on the way INTO the
   * offer, so "the source never said" and "the source said free" arrived at the
   * store as the same number — and the SERP connector says it never. The
   * distinction is now carried; the total still floors the unknown at 0, which
   * is why every surface has to caveat it.
   */
  it('carries an UNKNOWN shipping cost through as undefined, total floored', async () => {
    const { store, deps } = makeHarness([source({ type: 'SERP' })]);
    const registry = new ConnectorRegistry().register(
      stubConnector('SERP', [
        // Exactly what serp.ts produces today: no shippingCents field at all.
        { supplierName: 'Mercado Preço Bom', title: 'Coca-Cola Lata 350ml', priceCents: 400 },
      ]),
    );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 12 },
    });

    expect(result.offers[0]?.shippingCents).toBeUndefined();
    // Pack cost only — no phantom zero added, and none subtracted either.
    expect(result.offers[0]?.totalCents).toBe(4800);
    expect(store.offers[0]?.shippingCents).toBeUndefined();
  });

  it('keeps a STATED free shipping as 0, never conflated with unknown (FUT-518)', async () => {
    const { deps } = makeHarness([source({ type: 'AMAZON' })]);
    const registry = new ConnectorRegistry().register(
      stubConnector('AMAZON', [
        {
          supplierName: 'Loja com frete grátis',
          title: 'Coca-Cola Lata 350ml',
          priceCents: 400,
          shippingCents: 0,
        },
        {
          supplierName: 'Loja com frete',
          title: 'Coca-Cola Lata 350ml',
          priceCents: 400,
          shippingCents: 990,
        },
      ]),
    );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 12 },
    });

    const bySupplier = new Map(result.offers.map((entry) => [entry.supplierName, entry]));
    // 0 is an ANSWER, not a missing value — the whole distinction in one line.
    expect(bySupplier.get('Loja com frete grátis')?.shippingCents).toBe(0);
    expect(bySupplier.get('Loja com frete grátis')?.totalCents).toBe(4800);
    expect(bySupplier.get('Loja com frete')?.shippingCents).toBe(990);
    expect(bySupplier.get('Loja com frete')?.totalCents).toBe(5790);
  });
});

/**
 * FUT-516: the per-source wall-clock ceiling, at the pipeline level — what a
 * truncated source REPORTS, what happens to the offers it did collect, and what
 * is deliberately NOT done to it.
 *
 * `sourceBudgetMs: 0` is the lever: a budget of zero is spent the instant the
 * source starts, so every seam is refused and the outcome is deterministic
 * without any timer at all. The one test that needs the ceiling to fall DURING
 * the search drives the system clock instead.
 */
describe('runResearch — the per-source ceiling (FUT-516)', () => {
  const QUERY = { term: 'Coca-Cola Lata 350ml', quantity: 1 };
  const OFFER: RawOffer = { supplierName: 'Giga', title: 'Coca-Cola Lata 350ml', priceCents: 429 };

  const run = (deps: ResearchDeps, registry: ConnectorRegistry, overrides = {}) =>
    runResearch(deps, registry, ctx, { clientId: CLIENT, requestId: 'req-1', query: QUERY }, overrides);

  it('keeps the offers a cut source already had: OK + truncated, never degraded', async () => {
    const { store, deps } = makeHarness([source({})]);
    const registry = new ConnectorRegistry().register(stubConnector('VTEX', [OFFER]));

    const result = await run(deps, registry, { sourceBudgetMs: 0 });

    const stat = result.sourceStats[0];
    expect(stat?.status).toBe('OK');
    expect(stat?.truncated).toBe(true);
    // The partial answer SURVIVES — the ceiling lands in the transport, so the
    // connector unwound naturally and returned what it already had.
    expect(result.offers).toHaveLength(1);
    expect(store.offers).toHaveLength(1);
    // …and we observed OUR fan-out running out of time, not the store failing.
    expect(store.degraded).toEqual([]);
    expect(store.sources[0]?.status).toBe('ACTIVE');
  });

  it('records the CEILING sentence, not the connector\'s store-blaming one', async () => {
    const { store, deps } = makeHarness([source({ id: 'slow-1' })]);
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () =>
        Promise.resolve({ ok: false as const, error: 'VTEX catalog search unreachable: falha de conexão' }),
    });

    const result = await run(deps, registry, { sourceBudgetMs: 0 });

    const stat = result.sourceStats[0];
    expect(stat?.status).toBe('FAILED');
    expect(stat?.truncated).toBe(true);
    expect(stat?.error).toBe(sourceCeilingError(PT_BR_RESEARCH_DIAGNOSTICS.budget));
    expect(stat?.error).not.toContain('unreachable');
    // The latch stays open: `markSourceDegraded` notifies every
    // research-permission holder, and there is nothing here to notify about.
    expect(store.degraded).toEqual([]);
  });

  it('leaves the ordinary failure path alone — a failure INSIDE the budget still degrades', async () => {
    const { store, deps } = makeHarness([source({ id: 'down-1' })]);
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: false as const, error: 'HTTP 503' }),
    });

    const result = await run(deps, registry);

    const stat = result.sourceStats[0];
    expect(stat?.status).toBe('FAILED');
    expect(stat?.truncated).toBeUndefined();
    expect(stat?.error).toBe('HTTP 503');
    expect(store.degraded).toHaveLength(1);
  });

  it('clears a DEGRADED latch on a truncated answer — a slow store that answers recovered', async () => {
    const { store, deps } = makeHarness([source({ id: 'back-1', status: 'DEGRADED' })]);
    const registry = new ConnectorRegistry().register(stubConnector('VTEX', [OFFER]));

    const result = await run(deps, registry, { sourceBudgetMs: 0 });

    expect(result.sourceStats[0]?.truncated).toBe(true);
    expect(store.recovered).toEqual([{ sourceId: 'back-1', at: expect.any(Date) }]);
    expect(store.sources[0]?.status).toBe('ACTIVE');
  });

  it('caches a truncated answer under the SHORT ttl, and an untruncated one under the long one', async () => {
    const clock = { value: Date.parse('2026-07-31T09:00:00Z') };
    const cutStore = new InMemoryResearchStore();
    cutStore.sources = [source({})];
    const cutDeps: ResearchDeps = {
      store: cutStore,
      cache: new InMemoryCache(() => clock.value),
      budget: new FixedBudget(10),
      logger: silentLogger,
      diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
    };
    const calls = { count: 0 };
    const registry = new ConnectorRegistry().register(stubConnector('VTEX', [OFFER], calls));

    await run(cutDeps, registry, { sourceBudgetMs: 0, truncatedTtlSeconds: 300 });
    // Past the truncated ttl but far inside the 24h default: a partial answer
    // must not be the tenant's price list for a day.
    clock.value += 301_000;
    const afterCut = await run(cutDeps, registry, { sourceBudgetMs: 0, truncatedTtlSeconds: 300 });
    expect(afterCut.sourceStats[0]?.status).toBe('OK');
    expect(calls.count).toBe(2);

    const wholeStore = new InMemoryResearchStore();
    wholeStore.sources = [source({})];
    const wholeDeps: ResearchDeps = {
      store: wholeStore,
      cache: new InMemoryCache(() => clock.value),
      budget: new FixedBudget(10),
      logger: silentLogger,
      diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
    };
    const wholeCalls = { count: 0 };
    const wholeRegistry = new ConnectorRegistry().register(stubConnector('VTEX', [OFFER], wholeCalls));

    await run(wholeDeps, wholeRegistry);
    clock.value += 301_000;
    const afterWhole = await run(wholeDeps, wholeRegistry);
    expect(afterWhole.sourceStats[0]?.status).toBe('CACHED');
    expect(wholeCalls.count).toBe(1);
  });

  it('reports a hit on a truncated entry as CACHED + truncated, with zero connector calls', async () => {
    // The property that makes `attempts: 3` cheap: the retry 5s later reads
    // this entry instead of re-paying the ceiling — and it must still say the
    // answer was cut, or attempts two and three present it as a complete one.
    const { deps } = makeHarness([source({})]);
    const calls = { count: 0 };
    const registry = new ConnectorRegistry().register(stubConnector('VTEX', [OFFER], calls));

    await run(deps, registry, { sourceBudgetMs: 0 });
    const second = await run(deps, registry, { sourceBudgetMs: 0 });

    expect(calls.count).toBe(1);
    expect(second.sourceStats[0]?.status).toBe('CACHED');
    expect(second.sourceStats[0]?.truncated).toBe(true);
    expect(second.offers).toHaveLength(1);
  });

  it('reads the ceiling AFTER the connector returns, not before it is called', async () => {
    // The realistic shape: the source starts with its whole budget, spends it
    // mid-search, and is judged on the clock as it comes back.
    const base = Date.parse('2026-07-31T09:00:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(base);
    try {
      const { store, deps } = makeHarness([source({})]);
      const registry = new ConnectorRegistry().register({
        type: 'VTEX',
        search: () => {
          vi.setSystemTime(base + 61_000);
          return Promise.resolve({ ok: true as const, offers: [OFFER] });
        },
      });

      const result = await run(deps, registry, { sourceBudgetMs: 60_000 });

      expect(result.sourceStats[0]?.status).toBe('OK');
      expect(result.sourceStats[0]?.truncated).toBe(true);
      expect(store.degraded).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
