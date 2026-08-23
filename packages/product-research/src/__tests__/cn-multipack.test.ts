import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../connectors/registry';
import { createSerpConnector } from '../connectors/serp';
import type { ConnectorContext } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { parsePack } from '../normalize/pack';
import { runResearch } from '../pipeline/run-research';
import type { ResearchDeps } from '../ports';
import type { ResearchQuery, ScoredOffer, SourceRecord } from '../types';
import { PT_BR_MARKET_VOCABULARY } from '../normalize/pt-BR';
import {
  CN_MULTIPACK_FIXTURE,
  CN_MULTIPACK_TITLE,
  UNTITLED_PACK_TITLE,
} from './fixtures/cn-multipack';

/**
 * FUT-497 regression, on the payload of live run
 * 6d942a66-add9-45a2-91d1-bf62d9ed27da (tenant future-drink, "coca cola
 * 220ml"): the "C/12" box priced as a single R$ 39,83 can, and the sibling
 * offer whose pack size the title never states.
 */

const SERP_SOURCE: SourceRecord = {
  id: 'serp-1',
  clientId: 'future-drink',
  type: 'SERP',
  name: 'Busca web',
  config: {},
  enabled: true,
  status: 'ACTIVE',
};

// The buyer's real ask: twelve 220ml cans.
const QUERY: ResearchQuery = { term: 'coca cola 220ml', quantity: 12 };

const makeDeps = (): ResearchDeps => {
  const store = new InMemoryResearchStore();
  store.sources = [SERP_SOURCE];
  return { store, cache: new InMemoryCache(), budget: new FixedBudget(10), logger: silentLogger, diagnostics: PT_BR_RESEARCH_DIAGNOSTICS };
};

const ctx: ConnectorContext = {
  logger: silentLogger,
  diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  fetchJson: () => Promise.resolve(CN_MULTIPACK_FIXTURE),
};

const runFixture = async (): Promise<ScoredOffer[]> => {
  const registry = new ConnectorRegistry().register(
    createSerpConnector({ getApiKey: () => 'test-key', vocabulary: PT_BR_MARKET_VOCABULARY }),
  );
  const result = await runResearch(makeDeps(), registry, ctx, {
    clientId: 'future-drink',
    requestId: 'req-497',
    query: QUERY,
  });
  expect(result.status).toBe('COMPLETED');
  return result.offers;
};

const byTitle = (offers: ScoredOffer[], title: string): ScoredOffer => {
  const found = offers.find((offer) => offer.title === title);
  if (found === undefined) throw new Error(`fixture offer missing: ${title}`);
  return found;
};

describe('FUT-497 — "C/12" multipacks (live Google Shopping capture)', () => {
  it('parsePack reads 12 units of 220ml from the exact production title', () => {
    expect(parsePack(CN_MULTIPACK_TITLE)).toEqual({ units: 12, unitVolumeMl: 220 });
  });

  it('pipeline derives unitPriceCents 332 from priceCents 3983', async () => {
    const offers = await runFixture();

    // The SERP connector sets no packQuantity — the count comes from the title,
    // and the unit price is the box total ÷ 12, never the box total itself.
    expect(byTitle(offers, CN_MULTIPACK_TITLE)).toMatchObject({
      priceCents: 3983,
      packQuantity: 12,
      unitPriceCents: 332,
      // One box covers all twelve cans: the bug billed twelve BOXES here.
      totalCents: 3983,
    });
  });

  it('ranks the box by its true unit price, not as a R$ 39,83 can', async () => {
    const offers = await runFixture();
    const box = byTitle(offers, CN_MULTIPACK_TITLE);

    // 332/un beats the 3228/un unparsed multipack and loses to the ~290/un
    // cans — exactly where R$ 3,32 belongs, and nowhere near last place.
    expect(box.rank).toBe(7);
    expect(offers).toHaveLength(8);
    expect(offers[offers.length - 1]?.title).toBe(UNTITLED_PACK_TITLE);
    // Cheapest-first stays pure arithmetic on the per-unit cost.
    const unitPrices = offers.map((offer) => offer.unitPriceCents);
    expect(unitPrices).toEqual([...unitPrices].sort((a, b) => a - b));
  });

  it('keeps the shapes that already parsed — nothing regressed', async () => {
    const offers = await runFixture();

    expect(byTitle(offers, 'Refrigerante Coca Cola Lata 220ml FD 6 latas').packQuantity).toBe(6);
    expect(byTitle(offers, 'Coca Cola Lata 220ml Pack com 12 unidades').packQuantity).toBe(12);
    expect(
      byTitle(offers, 'Refrigerante Coca Cola 220ml Embalagem com 12 unidades').packQuantity,
    ).toBe(12);
    expect(byTitle(offers, 'Kit 2 Refrigerante Coca Cola Lata 220ml').packQuantity).toBe(2);
    expect(byTitle(offers, 'Refrigerante Coca Cola Original Lata 220ml').packQuantity).toBe(1);
  });
});

describe('FUT-497 — plausibility guard on the run the title cannot fix', () => {
  it('flags the R$ 32,28 "single can" whose pack size is only in the listing', async () => {
    const offers = await runFixture();

    // 3228 cents against a median unit price of 290 — 11.1x, and the offer
    // claims one unit. Flagged, still priced, still ranked by the arithmetic.
    expect(byTitle(offers, UNTITLED_PACK_TITLE)).toMatchObject({
      packQuantity: 1,
      unitPriceCents: 3228,
      suspectUnitPrice: true,
    });
  });

  it('leaves the parsed box and the genuine cans unflagged', async () => {
    const offers = await runFixture();

    expect(byTitle(offers, CN_MULTIPACK_TITLE).suspectUnitPrice).toBeUndefined();
    expect(
      offers
        .filter((offer) => offer.title !== UNTITLED_PACK_TITLE)
        .every((offer) => offer.suspectUnitPrice === undefined),
    ).toBe(true);
  });
});
