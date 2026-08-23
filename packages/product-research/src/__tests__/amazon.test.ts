import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import { createAmazonConnector, parseAmazonResponse } from '../connectors/amazon';
import { ConnectorRegistry } from '../connectors/registry';
import { SEARCHAPI_BUDGET_SCOPE } from '../connectors/searchapi';
import type { ConnectorContext } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import type { BudgetPort, ResearchDeps } from '../ports';
import type { SourceRecord } from '../types';
import { PT_BR_MARKET_VOCABULARY } from '../normalize/pt-BR';

// Shape mirrors a SearchApi.io `amazon_search` response for
// amazon_domain=amazon.com.br (documented response reference, 2026-07),
// trimmed to the fields the parser reads plus typical noise. NOT captured
// live — tests never call the vendor.
const AMAZON_FIXTURE = {
  search_metadata: { id: 'search_a1', status: 'Success' },
  search_parameters: {
    engine: 'amazon_search',
    q: 'Monster Energy 473ml',
    amazon_domain: 'amazon.com.br',
  },
  organic_results: [
    {
      position: 1,
      asin: 'B0MONSTER1',
      title: 'Energético Monster Energy, 473ml',
      link: 'https://www.amazon.com.br/Energetico-Monster-Energy-473ml/dp/B0MONSTER1/ref=sr_1_1?keywords=monster',
      thumbnail: 'https://m.media-amazon.com/images/I/monster473.jpg',
      rating: 4.8,
      reviews: 15230,
      price: 'R$ 8,99',
      extracted_price: 8.99,
      is_prime: true,
      delivery: ['Entrega GRÁTIS: amanhã'],
    },
    {
      position: 2,
      asin: 'B0MONSTER6',
      title: 'Energético Monster Energy 473ml Pack com 6 Unidades',
      link: 'https://www.amazon.com.br/dp/B0MONSTER6',
      // No extracted_price: the parser must fall back to the price string.
      price: 'R$ 47,94',
      availability: 'Restam apenas 3 em estoque',
      shipping_info: 'Frete GRÁTIS em pedidos acima de R$ 79',
    },
    {
      position: 3,
      asin: 'B0IMPORTED',
      title: 'Monster Energy Ultra imported 16oz',
      link: 'https://www.amazon.com.br/dp/B0IMPORTED',
      price: '$24.99',
      extracted_price: 24.99,
      currency: 'USD',
    },
    {
      position: 4,
      asin: 'B0NOPRICE0',
      title: 'Monster Energy sem oferta',
      // Neither price nor availability signal: must be discarded.
      link: 'https://www.amazon.com.br/dp/B0NOPRICE0',
    },
    {
      position: 5,
      asin: 'B0NOLINK00',
      title: 'Energético Monster Energy Zero 473ml',
      // No link: the canonical /dp/ URL must be built from the ASIN.
      price: 'R$ 9,49',
      extracted_price: 9.49,
      availability: 'Não disponível no momento',
    },
  ],
};

const source = (config: Record<string, unknown> = {}): SourceRecord => ({
  id: 'amazon-1',
  clientId: 'tenant-1',
  type: 'AMAZON',
  name: 'Amazon',
  config,
  enabled: true,
  status: 'ACTIVE',
});

const ctxWith = (
  responder: (url: string) => unknown | null,
  seen: { url: string; headers?: Record<string, string> }[] = [],
): ConnectorContext => ({
  logger: silentLogger,
  diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  fetchJson: (url, init) => {
    seen.push({ url, headers: init?.headers });
    return Promise.resolve(responder(url));
  },
});

const amazonConnector = () => createAmazonConnector({ getApiKey: () => 'test-key', vocabulary: PT_BR_MARKET_VOCABULARY });

describe('parseAmazonResponse', () => {
  // The shippingCents assertions below pin FUT-518's extraction: this
  // connector's private free-delivery regex moved onto the shared
  // normalize/shipping.ts that SERP now uses too.
  //
  // ONE VALUE DELIBERATELY CHANGED. The row reading "Frete GRÁTIS em pedidos
  // acima de R$ 79" used to yield 0 and now yields undefined: that shipping is
  // free above a basket minimum this research knows nothing about, and a price
  // search is usually pricing a single unit far below it. A confident 0 there
  // understated the total and won cheapest-first on freight the buyer would
  // actually pay at checkout — the exact defect FUT-518 exists to remove.
  it('extracts BRL offers with ASIN identity, prime/shipping hints and availability', () => {
    const offers = parseAmazonResponse(AMAZON_FIXTURE, PT_BR_MARKET_VOCABULARY);
    expect(offers).toHaveLength(3);
    // extracted_price wins; Prime badge → free shipping; "amanhã" → 1 day.
    expect(offers[0]).toMatchObject({
      supplierName: 'Amazon.com.br',
      title: 'Energético Monster Energy, 473ml',
      priceCents: 899,
      currency: 'BRL',
      shippingCents: 0,
      etaDays: 1,
      url: 'https://www.amazon.com.br/Energetico-Monster-Energy-473ml/dp/B0MONSTER1/ref=sr_1_1?keywords=monster',
      imageUrl: 'https://m.media-amazon.com/images/I/monster473.jpg',
    });
    // price-string fallback; CONDITIONAL free shipping is unknown, not free;
    // low-stock line is IN_STOCK.
    expect(offers[1]).toMatchObject({
      priceCents: 4794,
      availability: 'IN_STOCK',
      url: 'https://www.amazon.com.br/dp/B0MONSTER6',
    });
    expect(offers[1]?.shippingCents).toBeUndefined();
    expect(offers[1]?.etaDays).toBeUndefined();
    // Canonical buy link built from the ASIN; "não disponível" is OUT, never
    // read as available through its "disponível" suffix.
    expect(offers[2]).toMatchObject({
      priceCents: 949,
      availability: 'OUT_OF_STOCK',
      url: 'https://www.amazon.com.br/dp/B0NOLINK00',
    });
    expect(offers[2]?.shippingCents).toBeUndefined();
  });

  it('reads a quoted freight amount, keeps Prime as an override, leaves silence unknown', () => {
    const offers = parseAmazonResponse(
      {
        organic_results: [
        {
          asin: 'B0FRETE001',
          title: 'Energético com frete cobrado',
          price: 'R$ 10,00',
          extracted_price: 10,
          shipping_info: 'Frete: R$ 14,90',
        },
        {
          asin: 'B0PRIME001',
          title: 'Energético Prime',
          price: 'R$ 10,00',
          extracted_price: 10,
          // Prime is a shipping statement even when the row's text is silent.
          is_prime: true,
          delivery: ['Chega em 3 dias'],
        },
        {
          asin: 'B0QUIETO01',
          title: 'Energético sem informação de frete',
          price: 'R$ 10,00',
          extracted_price: 10,
          delivery: ['Chega em 3 dias'],
        },
        ],
      },
      PT_BR_MARKET_VOCABULARY,
    );
    expect(offers.map((offer) => offer.shippingCents)).toEqual([1490, 0, undefined]);
  });

  it('drops non-BRL results and results with neither price nor availability', () => {
    const titles = parseAmazonResponse(AMAZON_FIXTURE, PT_BR_MARKET_VOCABULARY).map((offer) => offer.title);
    expect(titles).not.toContain('Monster Energy Ultra imported 16oz');
    expect(titles).not.toContain('Monster Energy sem oferta');
  });

  it('keeps the verbatim result (ASIN included) in raw for offline replay', () => {
    const raw = parseAmazonResponse(AMAZON_FIXTURE, PT_BR_MARKET_VOCABULARY)[0]?.raw as Record<string, unknown>;
    expect(raw.asin).toBe('B0MONSTER1');
    expect(raw.position).toBe(1);
    expect(raw.rating).toBe(4.8);
  });

  it('tolerates unexpected payload shapes by returning no offers', () => {
    expect(parseAmazonResponse(null, PT_BR_MARKET_VOCABULARY)).toEqual([]);
    expect(parseAmazonResponse([], PT_BR_MARKET_VOCABULARY)).toEqual([]);
    expect(parseAmazonResponse({ error: 'weird' }, PT_BR_MARKET_VOCABULARY)).toEqual([]);
  });
});

describe('createAmazonConnector', () => {
  it('pins the amazon.com.br marketplace and the shared budget scope, key in the header only', async () => {
    const connector = amazonConnector();
    expect(connector.budgetScope).toBe(SEARCHAPI_BUDGET_SCOPE);

    const seen: { url: string; headers?: Record<string, string> }[] = [];
    const result = await connector.search(
      { term: 'Monster Energy 473ml', quantity: 6, region: '01310-100' },
      source(),
      ctxWith(() => AMAZON_FIXTURE, seen),
    );
    expect(result.ok).toBe(true);
    const url = new URL(seen[0]!.url);
    expect(url.origin + url.pathname).toBe('https://www.searchapi.io/api/v1/search');
    expect(url.searchParams.get('engine')).toBe('amazon_search');
    expect(url.searchParams.get('amazon_domain')).toBe('amazon.com.br');
    expect(url.searchParams.get('q')).toBe('Monster Energy 473ml');
    expect(url.searchParams.get('api_key')).toBeNull();
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
  });

  it('prefixes a brand the term is missing and honors a configured domain', async () => {
    const seen: { url: string }[] = [];
    await amazonConnector().search(
      { term: 'Energético 473ml', brand: 'Monster', quantity: 1 },
      source({ amazonDomain: 'amazon.com' }),
      ctxWith(() => AMAZON_FIXTURE, seen),
    );
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get('q')).toBe('Monster Energético 473ml');
    expect(url.searchParams.get('amazon_domain')).toBe('amazon.com');
  });

  it('reports a missing API key as a connector error, never throws', async () => {
    const keyless = createAmazonConnector({ getApiKey: () => undefined, vocabulary: PT_BR_MARKET_VOCABULARY });
    const seen: { url: string }[] = [];
    const result = await keyless.search(
      { term: 'Monster Energy 473ml', quantity: 1 },
      source(),
      ctxWith(() => AMAZON_FIXTURE, seen),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // FUT-517 inverted this assertion. The env var is a PLATFORM-operator
      // fact and this sentence is rendered to a tenant admin, who has no shell
      // to set one in — so its absence is now the thing under test.
      expect(result.error).not.toContain('SEARCHAPI_API_KEY');
      expect(result.error).toContain('chave de API não configurada');
      expect(result.error).toContain('amazon_search');
    }
    expect(seen).toHaveLength(0);
  });

  it('runs on the tenant credential from source.config even without a host env key', async () => {
    const keyless = createAmazonConnector({ getApiKey: () => undefined, vocabulary: PT_BR_MARKET_VOCABULARY });
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    const result = await keyless.search(
      { term: 'Monster Energy 473ml', quantity: 1 },
      source({ credentials: { apiKey: 'sk-tenant-amazon-1234' } }),
      ctxWith(() => AMAZON_FIXTURE, seen),
    );
    expect(result.ok).toBe(true);
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer sk-tenant-amazon-1234' });
  });

  it('prefers the tenant credential over the host env key when both exist', async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    await amazonConnector().search(
      { term: 'Monster Energy 473ml', quantity: 1 },
      source({ credentials: { apiKey: 'sk-tenant-amazon-1234' } }),
      ctxWith(() => AMAZON_FIXTURE, seen),
    );
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer sk-tenant-amazon-1234' });
  });

  it('reports an unreachable vendor as a connector error', async () => {
    const result = await amazonConnector().search(
      { term: 'Monster Energy 473ml', quantity: 1 },
      source(),
      ctxWith(() => null),
    );
    // An `fetchJson`-only host has no reason to give (FUT-495/502): the failure
    // is reported as an undetermined connection failure — and NOT as a timeout,
    // which this transport tier genuinely cannot tell.
    expect(result).toEqual({
      ok: false,
      error: 'SearchApi amazon_search: falha de conexão com o provedor (rede, DNS ou TLS)',
    });
  });

  it('surfaces a vendor-reported error body as a connector error', async () => {
    const result = await amazonConnector().search(
      { term: 'Monster Energy 473ml', quantity: 1 },
      source(),
      ctxWith(() => ({ error: 'Searches quota exceeded for your plan' })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The vendor's own words ARE the diagnostic, so they survive verbatim —
      // inside a pt-BR frame that marks them as the provider's, not ours.
      expect(result.error).toContain('quota exceeded');
      expect(result.error).toContain('resposta do provedor');
      expect(result.error).not.toContain(' error: ');
    }
  });

  it('bounds and single-lines an unbounded vendor body (the HTML error page case)', async () => {
    const htmlish = `<html>\n  <body>\n    ${'erro do provedor '.repeat(300)}\n  </body>\n</html>`;
    const result = await amazonConnector().search(
      { term: 'Monster Energy 473ml', quantity: 1 },
      source(),
      ctxWith(() => ({ error: htmlish })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeLessThan(300);
      expect(result.error.endsWith('…"')).toBe(true);
      expect(result.error).not.toContain('\n');
      expect(result.error).not.toContain('  ');
    }
  });

  it('reports an invalid config in pt-BR, without the zod English or the raw value', async () => {
    const seen: { url: string }[] = [];
    const result = await amazonConnector().search(
      { term: 'Monster Energy 473ml', quantity: 1 },
      source({ amazonDomain: 42 }),
      ctxWith(() => AMAZON_FIXTURE, seen),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Configuração da fonte');
      // The field PATH is the whole actionable diagnostic; zod's own sentence
      // is English and quotes the offending value, which can be a credential.
      expect(result.error).toContain('amazonDomain');
      expect(result.error).not.toContain('Invalid');
      expect(result.error).not.toContain('expected');
    }
    expect(seen).toHaveLength(0);
  });
});

describe('amazon offers inside a research run', () => {
  const makeDeps = (store: InMemoryResearchStore, budget: BudgetPort = new FixedBudget(10)): ResearchDeps => ({
    store,
    cache: new InMemoryCache(),
    budget,
    logger: silentLogger,
    diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  });

  it('ranks a 6-pack by unit price against single cans from Giga', async () => {
    const store = new InMemoryResearchStore();
    store.sources = [
      source(),
      { ...source(), id: 'giga-1', type: 'VTEX', name: 'Giga' },
    ];
    const registry = new ConnectorRegistry().register(amazonConnector()).register({
      type: 'VTEX',
      search: () =>
        Promise.resolve({
          ok: true as const,
          offers: [
            {
              supplierName: 'Giga',
              title: 'Energético Monster Energy Lata 473ml',
              priceCents: 849,
              currency: 'BRL',
              availability: 'IN_STOCK' as const,
            },
          ],
        }),
    });

    const result = await runResearch(
      makeDeps(store),
      registry,
      ctxWith(() => AMAZON_FIXTURE),
      {
        clientId: 'tenant-1',
        requestId: 'req-1',
        query: { term: 'Monster Energy 473ml', quantity: 6 },
      },
    );

    // The 6-pack amortizes to R$ 7,99/un — cheaper than both single cans.
    const pack = result.offers.find((offer) => offer.title.includes('Pack com 6'));
    expect(pack).toMatchObject({ rank: 1, packQuantity: 6, unitPriceCents: 799, totalCents: 4794 });
    const giga = result.offers.find((offer) => offer.supplierName === 'Giga');
    expect(giga?.unitPriceCents).toBe(849);
    expect(pack!.rank!).toBeLessThan(giga!.rank!);
  });

  it('shares one budget pool with SERP: both consume the SEARCHAPI scope', async () => {
    const store = new InMemoryResearchStore();
    store.sources = [
      source(),
      { ...source(), id: 'serp-1', type: 'SERP', name: 'Busca web' },
    ];
    const consumed: string[] = [];
    const shared = new FixedBudget(1);
    const budget: BudgetPort = {
      tryConsume: (input) => {
        consumed.push(input.sourceType);
        return shared.tryConsume(input);
      },
    };
    const registry = new ConnectorRegistry()
      .register(amazonConnector())
      .register({
        type: 'SERP',
        budgetScope: SEARCHAPI_BUDGET_SCOPE,
        search: () => Promise.resolve({ ok: true as const, offers: [] }),
      });

    const result = await runResearch(
      makeDeps(store, budget),
      registry,
      ctxWith(() => AMAZON_FIXTURE),
      {
        clientId: 'tenant-1',
        requestId: 'req-1',
        query: { term: 'Monster Energy 473ml', quantity: 1 },
      },
    );

    // Every paid consumption hit the SAME pool — and a 1-unit pool means the
    // second connector was refused, proving the cap is shared, not per-type.
    expect(consumed).toEqual([SEARCHAPI_BUDGET_SCOPE, SEARCHAPI_BUDGET_SCOPE]);
    const statuses = result.sourceStats.map((stat) => stat.status).sort();
    expect(statuses).toEqual(['BUDGET_EXCEEDED', 'OK']);
  });
});
