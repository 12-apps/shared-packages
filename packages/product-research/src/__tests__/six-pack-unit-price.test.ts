import { describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../connectors/registry';
import type { ConnectorContext } from '../connectors/types';
import { vtexConnector } from '../connectors/vtex';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { parsePack } from '../normalize/pack';
import { runResearch } from '../pipeline/run-research';
import type { ResearchDeps } from '../ports';
import type { SourceRecord } from '../types';

/**
 * FUT-436 regression: production research request
 * 786f82f8-ecbc-4cfa-a992-590525cc894d (tenant future-drink) ranked a 6-pack
 * Coca-Cola offer with a wrong unit price. Payload below was captured LIVE
 * from the Apoio Entrega VTEX catalog API on 2026-07-29, trimmed to the
 * fields the parser reads plus typical noise: the 6-pack sells at R$ 22,74
 * with unitMultiplier 1 / measurementUnit "un" (so the connector cannot know
 * the pack size — only the title says "6 Unidades"), and the single can sells
 * at R$ 4,29 in the same store. True unit price: 2274 / 6 = 379 cents.
 */
const SIX_PACK_TITLE =
  'Refrigerante sem Açúcar Coca-Cola Lata 6 Unidades 350ml Cada Leve Mais Pague Menos';

const APOIO_FIXTURE = [
  {
    productId: '187245',
    productName: SIX_PACK_TITLE,
    brand: 'Coca-Cola',
    linkText: 'refrigerante-sem-acucar-coca-cola-lata-6-unidades-350ml',
    link: 'https://www.apoioentrega.com.br/refrigerante-sem-acucar-coca-cola-lata-6-unidades-350ml/p',
    categories: ['/Bebidas/Refrigerantes/'],
    items: [
      {
        itemId: '187245',
        name: SIX_PACK_TITLE,
        ean: '7894900701753',
        unitMultiplier: 1,
        measurementUnit: 'un',
        images: [{ imageUrl: 'https://apoioentrega.vteximg.com.br/arquivos/ids/1/coca-6pack.png' }],
        sellers: [
          {
            sellerName: 'Apoio Entrega',
            commertialOffer: { Price: 22.74, ListPrice: 25.74, AvailableQuantity: 100 },
          },
        ],
      },
    ],
  },
  {
    productId: '187244',
    productName: 'Refrigerante sem Açúcar Coca-Cola Lata 350ml',
    brand: 'Coca-Cola',
    linkText: 'refrigerante-sem-acucar-coca-cola-lata-350ml',
    link: 'https://www.apoioentrega.com.br/refrigerante-sem-acucar-coca-cola-lata-350ml/p',
    categories: ['/Bebidas/Refrigerantes/'],
    items: [
      {
        itemId: '187244',
        name: 'Refrigerante sem Açúcar Coca-Cola Lata 350ml',
        ean: '7894900701012',
        unitMultiplier: 1,
        measurementUnit: 'un',
        images: [],
        sellers: [
          {
            sellerName: 'Apoio Entrega',
            commertialOffer: { Price: 4.29, ListPrice: 4.29, AvailableQuantity: 100 },
          },
        ],
      },
    ],
  },
];

const apoioSource: SourceRecord = {
  id: 'apoio-1',
  clientId: 'future-drink',
  type: 'VTEX',
  name: 'Apoio Entrega',
  config: { baseUrl: 'https://www.apoioentrega.com.br' },
  enabled: true,
  status: 'ACTIVE',
};

const ctx: ConnectorContext = {
  logger: silentLogger,
  fetchJson: () => Promise.resolve(APOIO_FIXTURE),
};

const makeDeps = (): ResearchDeps => {
  const store = new InMemoryResearchStore();
  store.sources = [apoioSource];
  return { store, cache: new InMemoryCache(), budget: new FixedBudget(10), logger: silentLogger };
};

describe('FUT-436 — 6-pack unit price (Apoio Entrega live capture)', () => {
  it('parsePack reads 6 units of 350ml from the exact production title', () => {
    expect(parsePack(SIX_PACK_TITLE)).toEqual({ units: 6, unitVolumeMl: 350 });
  });

  it('pipeline derives unitPriceCents 379 from priceCents 2274 via the title fallback', async () => {
    const registry = new ConnectorRegistry().register(vtexConnector);
    const result = await runResearch(makeDeps(), registry, ctx, {
      clientId: 'future-drink',
      requestId: 'req-436',
      query: { term: 'Coca-Cola Lata 350ml', brand: 'Coca-Cola', quantity: 6 },
    });

    expect(result.status).toBe('COMPLETED');
    const sixPack = result.offers.find((offer) => offer.title === SIX_PACK_TITLE);
    // The VTEX connector sets no packQuantity — the pack size must come from
    // the title, and the unit price is total ÷ units, never the pack total.
    expect(sixPack).toMatchObject({
      priceCents: 2274,
      packQuantity: 6,
      unitPriceCents: 379,
      totalCents: 2274,
    });
  });

  it('ranks by unit price: the 6-pack at 379/un outranks the 429 single can', async () => {
    const registry = new ConnectorRegistry().register(vtexConnector);
    const result = await runResearch(makeDeps(), registry, ctx, {
      clientId: 'future-drink',
      requestId: 'req-436',
      query: { term: 'Coca-Cola Lata 350ml', brand: 'Coca-Cola', quantity: 6 },
    });

    expect(result.offers).toHaveLength(2);
    // Despite the higher pack total (R$ 22,74 vs R$ 4,29), the 6-pack wins on
    // the per-unit axis — the mis-ordering FUT-436 reported must never return.
    expect(result.offers[0]).toMatchObject({
      title: SIX_PACK_TITLE,
      rank: 1,
      unitPriceCents: 379,
    });
    expect(result.offers[1]).toMatchObject({ rank: 2, unitPriceCents: 429 });
  });
});
