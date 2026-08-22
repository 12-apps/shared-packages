import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../connectors/registry';
import type { ConnectorContext, PriceSourceConnector } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import type { ResearchDeps } from '../ports';
import { dedupeOffers, offerIdentity } from '../ranking/dedupe';
import type { RawOffer, ScoredOffer, SourceRecord } from '../types';

describe('offerIdentity', () => {
  it('resolves any amazon listing-page shape to its ASIN, per marketplace host', () => {
    const canonical = offerIdentity('https://www.amazon.com.br/dp/B0MONSTER1');
    expect(canonical).toBe('amazon.com.br/asin/B0MONSTER1');
    // Slugged desktop link with affiliate/tracking noise — same listing.
    expect(
      offerIdentity(
        'https://www.amazon.com.br/Energetico-Monster/dp/b0monster1/ref=sr_1_1?keywords=monster&tag=goog-20&srsltid=AfmBOor123',
      ),
    ).toBe(canonical);
    // ASIN identity ignores query params entirely — /gp/product and ?psc=1
    // are still the same listing page.
    expect(offerIdentity('https://amazon.com.br/gp/product/B0MONSTER1?psc=1')).toBe(canonical);
    // The same ASIN on another marketplace is another offer.
    expect(offerIdentity('https://www.amazon.com/dp/B0MONSTER1')).toBe(
      'amazon.com/asin/B0MONSTER1',
    );
    expect(offerIdentity('https://www.amazon.com.br/dp/B0MONSTER2')).not.toBe(canonical);
  });

  it('normalizes generic urls: host case, www, trailing slash, tracking params', () => {
    const identity = offerIdentity('https://www.giga.com.br/monster-473ml/p?skuId=42');
    expect(identity).toBe('giga.com.br/monster-473ml/p?skuId=42');
    expect(
      offerIdentity('https://GIGA.com.br/monster-473ml/p/?skuId=42&utm_source=x&srsltid=AfmB1'),
    ).toBe(identity);
    // A functional param difference is a DIFFERENT offer, never collapsed.
    expect(offerIdentity('https://www.giga.com.br/monster-473ml/p?skuId=43')).not.toBe(identity);
  });

  it('has no identity without a parseable url', () => {
    expect(offerIdentity(undefined)).toBeNull();
    expect(offerIdentity('not a url')).toBeNull();
  });
});

const scored = (overrides: Partial<ScoredOffer>): ScoredOffer => ({
  sourceId: 'src-1',
  sourceType: 'SERP',
  supplierName: 'Amazon.com.br',
  title: 'Energético Monster Energy 473ml',
  currency: 'BRL',
  priceCents: 899,
  shippingCents: 0,
  packQuantity: 1,
  unitPriceCents: 899,
  totalCents: 899,
  relevanceScore: 1,
  ...overrides,
});

describe('dedupeOffers', () => {
  it('keeps only the best-ranked instance of one listing and renumbers ranks', () => {
    const ranked = [
      scored({ rank: 1, url: 'https://www.amazon.com.br/dp/B0MONSTER1', sourceType: 'AMAZON' }),
      scored({ rank: 2, url: 'https://www.giga.com.br/monster/p' }),
      scored({
        rank: 3,
        url: 'https://www.amazon.com.br/Energetico-Monster/dp/B0MONSTER1?srsltid=AfmB2',
        priceCents: 905,
      }),
    ];

    const deduped = dedupeOffers(ranked);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((offer) => offer.rank)).toEqual([1, 2]);
    expect(deduped[0]?.sourceType).toBe('AMAZON');
    expect(deduped[1]?.url).toBe('https://www.giga.com.br/monster/p');
  });

  it('never collapses offers without an identity', () => {
    const ranked = [
      scored({ rank: 1, url: undefined }),
      scored({ rank: 2, url: undefined }),
      scored({ rank: 3, url: 'not a url' }),
    ];
    expect(dedupeOffers(ranked)).toHaveLength(3);
  });
});

describe('cross-connector dedupe inside a research run', () => {
  const CLIENT = 'tenant-1';

  const source = (overrides: Partial<SourceRecord>): SourceRecord => ({
    id: 'src-1',
    clientId: CLIENT,
    type: 'SERP',
    name: 'Busca web',
    config: {},
    enabled: true,
    status: 'ACTIVE',
    ...overrides,
  });

  const stubConnector = (type: string, offers: RawOffer[]): PriceSourceConnector => ({
    type,
    search: () => Promise.resolve({ ok: true as const, offers }),
  });

  const ctx: ConnectorContext = { logger: silentLogger, fetchJson: () => Promise.resolve(null), diagnostics: PT_BR_RESEARCH_DIAGNOSTICS };

  it('shows the same amazon listing arriving via SERP and AMAZON exactly once', async () => {
    const store = new InMemoryResearchStore();
    store.sources = [
      source({ id: 'serp-1', type: 'SERP' }),
      source({ id: 'amazon-1', type: 'AMAZON', name: 'Amazon' }),
    ];
    const deps: ResearchDeps = {
      store,
      cache: new InMemoryCache(),
      budget: new FixedBudget(10),
      logger: silentLogger,
      diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
    };
    // Google Shopping deep-links the listing with tracking noise; the AMAZON
    // connector reports the clean /dp/ link. Same ASIN = same listing.
    const registry = new ConnectorRegistry()
      .register(
        stubConnector('SERP', [
          {
            supplierName: 'Amazon.com.br',
            title: 'Energético Monster Energy 473ml',
            priceCents: 899,
            currency: 'BRL',
            url: 'https://www.amazon.com.br/Energetico-Monster/dp/B0MONSTER1/ref=asc_df?tag=goog-20&srsltid=AfmBOor1',
          },
          {
            supplierName: 'Giga',
            title: 'Energético Monster Energy 473ml',
            priceCents: 879,
            currency: 'BRL',
            url: 'https://www.giga.com.br/monster-energy-473ml/p',
          },
        ]),
      )
      .register(
        stubConnector('AMAZON', [
          {
            supplierName: 'Amazon.com.br',
            title: 'Energético Monster Energy 473ml',
            priceCents: 899,
            currency: 'BRL',
            availability: 'IN_STOCK',
            url: 'https://www.amazon.com.br/dp/B0MONSTER1',
          },
        ]),
      );

    const result = await runResearch(deps, registry, ctx, {
      clientId: CLIENT,
      requestId: 'req-1',
      query: { term: 'Monster Energy 473ml', quantity: 1 },
    });

    const amazonOffers = result.offers.filter((offer) =>
      offer.url?.includes('amazon.com.br'),
    );
    expect(amazonOffers).toHaveLength(1);
    expect(result.offers).toHaveLength(2);
    expect(result.offers.map((offer) => offer.rank)).toEqual([1, 2]);
    // The cheaper Giga offer still leads — dedupe removed a duplicate, not a
    // competitor.
    expect(result.offers[0]?.supplierName).toBe('Giga');
    // The persisted rows match what the buyer sees.
    expect(store.offers).toHaveLength(2);
  });
});
