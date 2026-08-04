import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../connectors/registry';
import type { ConnectorContext, PriceSourceConnector } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import { effectiveUnitCents, rankOffers } from '../ranking/rank';
import type { LoggerPort, ResearchDeps, ResearchRunProgressEvent, ResearchStore } from '../ports';
import type { RawOffer, ScoredOffer, SourceRecord } from '../types';

/**
 * FUT-519: a run's offers become readable AS EACH SOURCE SETTLES, not after
 * the slowest one. What that costs — and what makes it safe — is pinned here:
 * appended rows carry no rank, the terminal write REPLACES them, and the whole
 * design rests on `totalCents asc` reproducing `rankOffers`' order (the last
 * describe block).
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

const ctx: ConnectorContext = { logger: silentLogger, fetchJson: () => Promise.resolve(null) };

const query = { term: 'Coca-Cola Lata 350ml', brand: 'Coca-Cola', quantity: 1 };

interface Harness {
  store: InMemoryResearchStore;
  deps: ResearchDeps;
  events: ResearchRunProgressEvent[];
  warnings: string[];
}

const makeHarness = (sources: SourceRecord[]): Harness => {
  const harnessStore = new InMemoryResearchStore();
  harnessStore.sources = sources;
  const observed: ResearchRunProgressEvent[] = [];
  const warned: string[] = [];
  const logger: LoggerPort = {
    info: () => undefined,
    warn: (message) => {
      warned.push(message);
    },
    error: () => undefined,
  };
  return {
    store: harnessStore,
    events: observed,
    warnings: warned,
    deps: {
      store: harnessStore,
      cache: new InMemoryCache(),
      budget: new FixedBudget(10),
      logger,
      events: {
        sourceDegraded: () => undefined,
        runProgress: (event) => {
          observed.push(event);
        },
      },
    },
  };
};

/** A gate a slow connector awaits, so "mid-run" is a state a test can hold. */
const makeGate = (): { release: () => void; answered: Promise<void> } => {
  const resolver: { fire: () => void } = { fire: () => undefined };
  const answered = new Promise<void>((resolve) => {
    resolver.fire = resolve;
  });
  return { release: () => resolver.fire(), answered };
};

/** VTEX answers immediately; MANUAL waits on the gate. */
const gatedRegistry = (gate: { answered: Promise<void> }, slowOffers: RawOffer[] = []) =>
  new ConnectorRegistry()
    .register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: true as const, offers: [OFFER] }),
    })
    .register({
      type: 'MANUAL',
      cacheable: false,
      search: async () => {
        await gate.answered;
        return { ok: true as const, offers: slowOffers };
      },
    } satisfies PriceSourceConnector);

const TWO_SOURCES = [
  source({ id: 'src-fast', name: 'Rápida' }),
  source({ id: 'src-slow', name: 'Lenta', type: 'MANUAL' }),
];

describe('offers readable while the run is still in flight', () => {
  it('persists the fast source’s offers before the slow one answers, unranked', async () => {
    const { store, deps } = makeHarness(TWO_SOURCES);
    const gate = makeGate();

    const running = runResearch(deps, gatedRegistry(gate), ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });

    await expect.poll(() => store.offers.length).toBe(1);
    // The whole point: a price is readable while the run is NOT terminal.
    expect(store.runs[0]?.status).toBe('RUNNING');
    // …and it carries NO rank. A provisional per-source 1..n would pin this
    // batch above every later source's cheaper offers under the host's
    // `rank asc NULLS LAST` read — the single easiest way to get this wrong.
    expect(store.offers.every((offer) => offer.rank === undefined)).toBe(true);

    gate.release();
    const result = await running;
    expect(result.status).toBe('COMPLETED');
    expect(store.runs[0]?.status).toBe('COMPLETED');
    // The terminal write is authoritative: ranks are 1..n and the persisted
    // rows are exactly the returned ones — no leftover pre-rank duplicates.
    expect(store.offers.map((offer) => offer.rank)).toEqual([1]);
    expect(store.offers).toHaveLength(result.offers.length);
  });

  it('never emits a settled event ahead of the rows it advertises', async () => {
    const { store, deps } = makeHarness(TWO_SOURCES);
    const gate = makeGate();
    // Snapshot the store AT emission time: the durable write must already
    // have happened, or a subscriber re-reading on the event sees less than
    // the event's `offerCount` promised.
    const snapshots: { offerCount: number; stored: number }[] = [];
    deps.events = {
      sourceDegraded: () => undefined,
      runProgress: (event) => {
        if (event.kind === 'source-settled') {
          snapshots.push({ offerCount: event.stat.offerCount, stored: store.offers.length });
        }
      },
    };

    const running = runResearch(deps, gatedRegistry(gate, [OFFER]), ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });
    await expect.poll(() => snapshots.length).toBe(1);
    gate.release();
    await running;

    expect(snapshots).toHaveLength(2);
    // Every source's offers here clear the relevance filter, so the stat's raw
    // count equals what was written: the store must hold at least the running
    // total by the time each event fires.
    const shortfalls = snapshots.filter(
      (snapshot, index) =>
        snapshot.stored <
        snapshots.slice(0, index + 1).reduce((sum, seen) => sum + seen.offerCount, 0),
    );
    expect(shortfalls).toEqual([]);
  });

  it('replaces the appended rows with the ranked, deduped final set', async () => {
    const { store, deps } = makeHarness(TWO_SOURCES);
    const gate = makeGate();
    // Both sources return the SAME listing URL, so dedupe collapses them: the
    // persisted set must be the post-dedupe one, with no append left behind.
    const shared: RawOffer = { ...OFFER, url: 'https://loja.example/coca-lata-350' };
    const registry = new ConnectorRegistry()
      .register({
        type: 'VTEX',
        search: () => Promise.resolve({ ok: true as const, offers: [shared] }),
      })
      .register({
        type: 'MANUAL',
        cacheable: false,
        search: async () => {
          await gate.answered;
          return { ok: true as const, offers: [shared] };
        },
      } satisfies PriceSourceConnector);

    const running = runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });
    await expect.poll(() => store.offers.length).toBe(1);
    gate.release();
    const result = await running;

    expect(result.offers).toHaveLength(1);
    expect(store.offers).toHaveLength(1);
    expect(store.offers[0]?.rank).toBe(1);
  });
});

describe('hosts that cannot append', () => {
  /** The same store, minus the optional capability — a pre-FUT-519 host. */
  const withoutAppend = (store: InMemoryResearchStore): ResearchStore => ({
    listEnabledSources: (clientId) => store.listEnabledSources(clientId),
    createRun: (input) => store.createRun(input),
    updateRun: (input) => store.updateRun(input),
    appendRunSourceStat: (input) => store.appendRunSourceStat(input),
    insertOffers: (input) => store.insertOffers(input),
    markSourceDegraded: (input) => store.markSourceDegraded(input),
    markSourceRecovered: (input) => store.markSourceRecovered(input),
  });

  it('sees nothing mid-run and the identical final list', async () => {
    const { store, deps } = makeHarness(TWO_SOURCES);
    deps.store = withoutAppend(store);
    const gate = makeGate();

    const running = runResearch(deps, gatedRegistry(gate), ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });
    await expect.poll(() => store.runs[0]?.sourceStats.length).toBe(1);
    // The stat streamed; the offers did not — exactly the pre-FUT-519 view.
    expect(store.offers).toEqual([]);

    gate.release();
    const result = await running;
    expect(result.status).toBe('COMPLETED');
    expect(store.offers).toHaveLength(result.offers.length);
    expect(store.offers.map((offer) => offer.rank)).toEqual([1]);
  });

  it('keeps the run green when the append itself fails, and says so', async () => {
    const { store, deps, warnings } = makeHarness([source({ id: 'src-fast', name: 'Rápida' })]);
    Object.assign(store, {
      appendRunOffers: () => Promise.reject(new Error('disco cheio')),
    });
    const registry = new ConnectorRegistry().register({
      type: 'VTEX',
      search: () => Promise.resolve({ ok: true as const, offers: [OFFER] }),
    });

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query,
    });

    // Best-effort by port contract: the partial view is what breaks, not the
    // run — the terminal write still lands the full, ranked list.
    expect(result.status).toBe('COMPLETED');
    expect(result.offers).toHaveLength(1);
    expect(store.offers.map((offer) => offer.rank)).toEqual([1]);
    expect(warnings).toContain('incremental offer write failed');
  });
});

/**
 * THE INVARIANT THE WHOLE PARTIAL VIEW RESTS ON. A RUNNING run's rows are
 * unranked, so the host reads them with `totalCents asc` alone
 * (`getResearchRun`, apps/web/lib/repositories/research.ts). That is only
 * honest while it reproduces `rankOffers`. If a future ticket adds a weighting
 * to the ranking, this is the test that refuses it.
 */
describe('totalCents order equals rankOffers order', () => {
  const QUANTITY = 12;

  const priced = (input: {
    title: string;
    priceCents: number;
    packQuantity?: number;
    shippingCents?: number;
    etaDays?: number;
    outsideDeliveryArea?: boolean;
  }): ScoredOffer => {
    const packQuantity = input.packQuantity ?? 1;
    const shippingCents = input.shippingCents ?? 0;
    // The same arithmetic `toScoredOffer` writes into the column.
    const packsNeeded = Math.ceil(QUANTITY / packQuantity);
    return {
      sourceId: 'src-1',
      sourceType: 'VTEX',
      supplierName: 'Loja',
      title: input.title,
      currency: 'BRL',
      priceCents: input.priceCents,
      shippingCents,
      packQuantity,
      unitPriceCents: Math.round(input.priceCents / packQuantity),
      totalCents: packsNeeded * input.priceCents + shippingCents,
      relevanceScore: 0.99,
      etaDays: input.etaDays,
      outsideDeliveryArea: input.outsideDeliveryArea,
    };
  };

  const MIXED = [
    priced({ title: 'unidade', priceCents: 359 }),
    priced({ title: 'caixa-24', priceCents: 7000, packQuantity: 24 }),
    priced({ title: 'frete-caro', priceCents: 300, shippingCents: 900 }),
    priced({ title: 'fardo-12', priceCents: 3999, packQuantity: 12 }),
    priced({ title: 'meia-duzia', priceCents: 2100, packQuantity: 6 }),
  ];

  it('is a monotone transform: effectiveUnitCents is round(totalCents / units)', () => {
    for (const offer of MIXED) {
      expect(effectiveUnitCents(offer, QUANTITY)).toBe(Math.round(offer.totalCents / QUANTITY));
    }
  });

  it('orders a mixed set of packs, shipping and singles identically', () => {
    const ranked = rankOffers(MIXED, QUANTITY);
    const byTotal = [...MIXED].sort((a, b) => a.totalCents - b.totalCents);

    expect(byTotal.map((offer) => offer.title)).toEqual(ranked.map((offer) => offer.title));
    expect(ranked.map((offer) => offer.title)).toEqual([
      'fardo-12',
      'meia-duzia',
      'unidade',
      'frete-caro',
      'caixa-24',
    ]);
  });

  it('diverges only INSIDE a cost tie, where the tiebreak is the ranking’s own', () => {
    // Identical realizable cost: `rankOffers` then prefers the in-area offer,
    // and a plain totalCents sort (stable) keeps input order. This is the ONLY
    // permitted divergence — it can reorder rows that cost the same, never move
    // one past a cheaper one, so the partial view never re-sorts across a price
    // boundary when the run completes.
    const tied = [
      priced({ title: 'fora-da-area', priceCents: 4000, packQuantity: 12, outsideDeliveryArea: true }),
      priced({ title: 'aqui', priceCents: 4000, packQuantity: 12, etaDays: 2 }),
    ];
    const ranked = rankOffers(tied, QUANTITY);
    const byTotal = [...tied].sort((a, b) => a.totalCents - b.totalCents);

    expect(ranked.map((offer) => offer.title)).toEqual(['aqui', 'fora-da-area']);
    expect(byTotal.map((offer) => offer.title)).toEqual(['fora-da-area', 'aqui']);
    // The COST sequence — what the buyer reads down the column — is identical.
    expect(byTotal.map((offer) => offer.totalCents)).toEqual(
      ranked.map((offer) => offer.totalCents),
    );
  });
});
