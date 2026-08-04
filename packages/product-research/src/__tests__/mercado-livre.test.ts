import { describe, expect, it } from 'vitest';
import { createMercadoLivreConnector, parseMercadoLivreSearch } from '../connectors/mercado-livre';
import { createMercadoLivreAuth } from '../connectors/mercado-livre-auth';
import type { MercadoLivreAuth, MercadoLivreCredentials } from '../connectors/mercado-livre-auth';
import { ConnectorRegistry } from '../connectors/registry';
import type { ConnectorContext } from '../connectors/types';
import { FixedBudget, InMemoryCache, InMemoryResearchStore, silentLogger } from '../memory';
import { runResearch } from '../pipeline/run-research';
import type { SourceRecord } from '../types';

const API = 'https://api.mercadolibre.com';
const TOKEN_URL = `${API}/oauth/token`;

// Shapes mirror the documented MLB payloads (developers.mercadolivre.com.br),
// trimmed to the fields the parser reads plus typical noise.
const SEARCH_FIXTURE = {
  site_id: 'MLB',
  paging: { total: 6, limit: 50 },
  results: [
    {
      id: 'MLB111',
      title: 'Refrigerante Coca-Cola Lata 350ml',
      condition: 'new',
      price: 4.49,
      currency_id: 'BRL',
      available_quantity: 250,
      permalink: 'https://produto.mercadolivre.com.br/MLB-111-coca-cola-lata-350ml',
      thumbnail: 'https://http2.mlstatic.com/D_111-I.jpg',
      seller: {
        id: 5001,
        nickname: 'DISTRIBUIDORA SANTOS',
        seller_reputation: { level_id: '5_green', power_seller_status: 'platinum' },
      },
      shipping: { free_shipping: false, logistic_type: 'fulfillment' },
      attributes: [
        { id: 'BRAND', value_name: 'Coca-Cola' },
        { id: 'GTIN', value_name: '7894900011517' },
      ],
    },
    {
      id: 'MLB222',
      title: 'Coca-Cola Lata 350ml Fardo 12x350ml',
      condition: 'new',
      price: 42,
      currency_id: 'BRL',
      available_quantity: 40,
      permalink: 'https://produto.mercadolivre.com.br/MLB-222-fardo',
      seller: { id: 5002, nickname: 'BEBIDAS ATACADO BR', seller_reputation: { level_id: '5_green' } },
      shipping: { free_shipping: true },
    },
    {
      id: 'MLB333',
      title: 'Coca-Cola Lata 350ml usada colecionador',
      condition: 'used',
      price: 15,
      seller: { id: 5003, nickname: 'COLECIONADOR', seller_reputation: { level_id: '5_green' } },
    },
    {
      id: 'MLB444',
      title: 'Coca-Cola Lata 350ml',
      condition: 'new',
      price: 3.99,
      seller: { id: 5004, nickname: 'VENDEDOR NOVATO', seller_reputation: { level_id: '2_orange' } },
    },
    {
      id: 'MLB555',
      title: 'Coca-Cola Lata 350ml esgotada',
      condition: 'new',
      price: 4.2,
      available_quantity: 0,
      seller: { id: 5005, nickname: 'SEM ESTOQUE', seller_reputation: { level_id: '5_green' } },
    },
    {
      id: 'MLB666',
      title: 'Coca-Cola Lata 350ml sem preço',
      condition: 'new',
      seller: { id: 5006, nickname: 'SEM PREÇO', seller_reputation: { level_id: '5_green' } },
    },
  ],
};

const CATALOG_SEARCH_FIXTURE = {
  results: [{ id: 'MLB19541902', name: 'Coca-Cola Lata 350ml', status: 'active' }],
};

const CATALOG_PRODUCT_FIXTURE = {
  id: 'MLB19541902',
  name: 'Coca-Cola Lata 350ml',
  permalink: 'https://www.mercadolivre.com.br/p/MLB19541902',
  pictures: [{ url: 'https://http2.mlstatic.com/D_catalog.jpg' }],
  buy_box_winner: {
    item_id: 'MLB777',
    price: 3.79,
    currency_id: 'BRL',
    available_quantity: 500,
    seller_id: 7001,
    shipping: { free_shipping: false },
  },
};

const USER_FIXTURE = { id: 7001, nickname: 'ATACADO GUANABARA' };

const SHIPPING_OPTIONS_FIXTURE = {
  destination: { zip_code: '01310100' },
  options: [
    { id: 1, name: 'Normal', cost: 12.9 },
    { id: 2, name: 'Expresso', cost: 22.5 },
  ],
};

const TOKEN_FIXTURE = {
  access_token: 'APP_USR_TOKEN_1',
  token_type: 'Bearer',
  expires_in: 21600,
  refresh_token: 'TG-ROTATED-1',
};

const source = (config: Record<string, unknown> = {}): SourceRecord => ({
  id: 'ml-1',
  clientId: 'tenant-1',
  type: 'MERCADO_LIVRE',
  name: 'Mercado Livre',
  config,
  enabled: true,
  status: 'ACTIVE',
});

interface FakeTransport {
  ctx: ConnectorContext;
  gets: { url: string; token: string | undefined }[];
  posts: { url: string; form: Record<string, string> }[];
}

const transportWith = (
  respond: (url: string) => unknown | null,
  tokenPayload: (form: Record<string, string>) => unknown | null = () => TOKEN_FIXTURE,
): FakeTransport => {
  const gets: FakeTransport['gets'] = [];
  const posts: FakeTransport['posts'] = [];
  return {
    gets,
    posts,
    ctx: {
      logger: silentLogger,
      fetchJson: (url, init) => {
        gets.push({ url, token: init?.headers?.["Authorization"] });
        return Promise.resolve(respond(url));
      },
      postForm: (url, form) => {
        posts.push({ url, form });
        return Promise.resolve(tokenPayload(form));
      },
    },
  };
};

const credentials = (overrides: Partial<MercadoLivreCredentials> = {}): MercadoLivreCredentials => ({
  clientId: 'app-123',
  clientSecret: 'secret-xyz',
  ...overrides,
});

const authWith = (creds: MercadoLivreCredentials | null, now?: () => number): MercadoLivreAuth =>
  createMercadoLivreAuth({ credentials: () => creds, now });

const connectorWith = (auth: MercadoLivreAuth) => createMercadoLivreConnector({ auth });

describe('createMercadoLivreAuth', () => {
  it('acquires an app token via client_credentials and caches it', async () => {
    const transport = transportWith(() => SEARCH_FIXTURE);
    const auth = authWith(credentials());

    await connectorWith(auth).search({ term: 'Coca-Cola Lata 350ml', quantity: 1 }, source(), transport.ctx);
    await connectorWith(auth).search({ term: 'Coca-Cola Lata 350ml', quantity: 1 }, source(), transport.ctx);

    expect(transport.posts).toHaveLength(1);
    expect(transport.posts[0]).toEqual({
      url: TOKEN_URL,
      form: { grant_type: 'client_credentials', client_id: 'app-123', client_secret: 'secret-xyz' },
    });
    expect(transport.gets[0]?.token).toBe('Bearer APP_USR_TOKEN_1');
  });

  it('uses the refresh_token grant when a refresh token is configured, and rotates it', async () => {
    const clock = { now: 0 };
    const transport = transportWith(() => SEARCH_FIXTURE);
    const auth = authWith(credentials({ refreshToken: 'TG-SEED' }), () => clock.now);
    const connector = connectorWith(auth);
    const query = { term: 'Coca-Cola Lata 350ml', quantity: 1 };

    await connector.search(query, source(), transport.ctx);
    clock.now = 22_000 * 1000; // past expires_in — forces a second grant
    await connector.search(query, source(), transport.ctx);

    expect(transport.posts[0]?.form).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'TG-SEED',
    });
    expect(transport.posts[1]?.form).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'TG-ROTATED-1',
    });
  });
});

describe('mercadoLivreConnector', () => {
  it('maps search results to raw offers with seller nickname, permalink and GTIN', async () => {
    const transport = transportWith(() => SEARCH_FIXTURE);
    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola Lata 350ml', brand: 'Coca-Cola', quantity: 12 },
      source(),
      transport.ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offers).toHaveLength(2);
    expect(result.offers[0]).toMatchObject({
      supplierName: 'DISTRIBUIDORA SANTOS',
      title: 'Refrigerante Coca-Cola Lata 350ml',
      url: 'https://produto.mercadolivre.com.br/MLB-111-coca-cola-lata-350ml',
      imageUrl: 'https://http2.mlstatic.com/D_111-I.jpg',
      ean: '7894900011517',
      currency: 'BRL',
      priceCents: 449,
      availability: 'IN_STOCK',
    });
    expect(result.offers[1]).toMatchObject({
      supplierName: 'BEBIDAS ATACADO BR',
      priceCents: 4200,
      shippingCents: 0,
    });
    const searchUrl = transport.gets[0]?.url ?? '';
    expect(searchUrl).toContain(`${API}/sites/MLB/search`);
    expect(searchUrl).toContain('q=Coca-Cola%20Lata%20350ml');
    expect(searchUrl).toContain('condition=new');
  });

  it('drops used, low-reputation, out-of-stock and priceless listings', () => {
    const offers = parseMercadoLivreSearch(SEARCH_FIXTURE, source());
    expect(offers.map((offer) => offer.supplierName)).toEqual([
      'DISTRIBUIDORA SANTOS',
      'BEBIDAS ATACADO BR',
    ]);
  });

  it('keeps unknown payload fields in raw for offline replay', () => {
    const offers = parseMercadoLivreSearch(SEARCH_FIXTURE, source());
    const raw = offers[0]?.raw as Record<string, unknown>;
    expect(raw.id).toBe('MLB111');
    expect((raw.shipping as Record<string, unknown>).logistic_type).toBe('fulfillment');
  });

  it('looks up by EAN via catalog products first, resolving the buy-box seller nickname', async () => {
    const transport = transportWith((url) => {
      if (url.includes('/products/search')) return CATALOG_SEARCH_FIXTURE;
      if (url.includes('/products/MLB19541902')) return CATALOG_PRODUCT_FIXTURE;
      if (url.includes('/users/7001')) return USER_FIXTURE;
      return null;
    });

    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola Lata 350ml', ean: '7894900011517', quantity: 1 },
      source(),
      transport.ctx,
    );

    const catalogUrl = transport.gets[0]?.url ?? '';
    expect(catalogUrl).toContain(`${API}/products/search`);
    expect(catalogUrl).toContain('product_identifier=7894900011517');
    expect(catalogUrl).toContain('site_id=MLB');
    expect(catalogUrl).toContain('status=active');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]).toMatchObject({
      supplierName: 'ATACADO GUANABARA',
      title: 'Coca-Cola Lata 350ml',
      url: 'https://www.mercadolivre.com.br/p/MLB19541902',
      ean: '7894900011517',
      priceCents: 379,
    });
    expect(transport.gets.some((call) => call.url.includes('/sites/MLB/search'))).toBe(false);
  });

  it('falls back to text search when the catalog does not know the EAN', async () => {
    const transport = transportWith((url) => {
      if (url.includes('/products/search')) return { results: [] };
      if (url.includes('/sites/MLB/search')) return SEARCH_FIXTURE;
      return null;
    });

    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola Lata 350ml', ean: '0000000000000', quantity: 1 },
      source(),
      transport.ctx,
    );

    expect(result.ok && result.offers).toHaveLength(2);
    expect(transport.gets[0]?.url).toContain('/products/search');
    expect(transport.gets[1]?.url).toContain('/sites/MLB/search');
  });

  it('surfaces a fallback outage as an error, not an empty success', async () => {
    const transport = transportWith((url) =>
      url.includes('/products/search') ? { results: [] } : null,
    );

    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola Lata 350ml', ean: '0000000000000', quantity: 1 },
      source(),
      transport.ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unreachable');
  });

  it('degrades on missing credentials without ever fetching', async () => {
    const transport = transportWith(() => SEARCH_FIXTURE);
    const result = await connectorWith(authWith(null)).search(
      { term: 'Coca-Cola Lata 350ml', quantity: 1 },
      source(),
      transport.ctx,
    );

    expect(result).toEqual({ ok: false, error: expect.stringContaining('auth failed') });
    expect(transport.gets).toHaveLength(0);
  });

  it('degrades when the token endpoint refuses the grant, never throws', async () => {
    const transport = transportWith(
      () => SEARCH_FIXTURE,
      () => ({ error: 'invalid_client', status: 400 }),
    );

    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola Lata 350ml', quantity: 1 },
      source(),
      transport.ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('auth failed');
  });

  it('retries once with a fresh token when a mid-run 401 folds into null', async () => {
    const tokens = { issued: 0 };
    const transport = transportWith(
      () => null,
      () => {
        tokens.issued += 1;
        return { ...TOKEN_FIXTURE, access_token: `TOKEN_${tokens.issued}`, refresh_token: undefined };
      },
    );
    // The transport answers only when the SECOND token is presented — an
    // expired-token 401 looks exactly like this from the connector's side.
    transport.ctx.fetchJson = (url, init) => {
      transport.gets.push({ url, token: init?.headers?.["Authorization"] });
      return Promise.resolve(init?.headers?.["Authorization"] === 'Bearer TOKEN_2' ? SEARCH_FIXTURE : null);
    };

    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola Lata 350ml', quantity: 1 },
      source(),
      transport.ctx,
    );

    expect(result.ok && result.offers).toHaveLength(2);
    expect(tokens.issued).toBe(2);
    expect(transport.gets.map((call) => call.token)).toEqual(['Bearer TOKEN_1', 'Bearer TOKEN_2']);
  });

  it('captures a shipping estimate by CEP for paid-shipping offers, best-effort', async () => {
    const transport = transportWith((url) => {
      if (url.includes('/sites/MLB/search')) return SEARCH_FIXTURE;
      if (url === `${API}/items/MLB111/shipping_options?zip_code=01310100`) {
        return SHIPPING_OPTIONS_FIXTURE;
      }
      return null;
    });

    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola Lata 350ml', quantity: 1, region: '01310-100' },
      source(),
      transport.ctx,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offers[0]?.shippingCents).toBe(1290);
    // The free-shipping fardo keeps its 0 — no lookup wasted on it.
    expect(result.offers[1]?.shippingCents).toBe(0);
    expect(transport.gets.filter((call) => call.url.includes('shipping_options'))).toHaveLength(1);
  });

  it('leaves shipping undefined when the estimate endpoint fails, without degrading', async () => {
    const transport = transportWith((url) =>
      url.includes('/sites/MLB/search') ? SEARCH_FIXTURE : null,
    );

    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola Lata 350ml', quantity: 1, region: '01310-100' },
      source(),
      transport.ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.offers[0]?.shippingCents).toBeUndefined();
  });

  it('rejects an invalid config with a clear error', async () => {
    const transport = transportWith(() => SEARCH_FIXTURE);
    const result = await connectorWith(authWith(credentials())).search(
      { term: 'Coca-Cola', quantity: 1 },
      source({ siteId: 'not-a-site' }),
      transport.ctx,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('invalid Mercado Livre config');
  });

  it('tolerates unexpected payload shapes by returning no offers', () => {
    expect(parseMercadoLivreSearch({ message: 'invalid_token' }, source())).toEqual([]);
    expect(parseMercadoLivreSearch(null, source())).toEqual([]);
  });
});

describe('mercado livre in the pipeline', () => {
  const harness = () => {
    const store = new InMemoryResearchStore();
    store.sources = [source()];
    return {
      store,
      deps: { store, cache: new InMemoryCache(), budget: new FixedBudget(10), logger: silentLogger },
    };
  };

  it('ranks a 12-unit fardo by unit price against single-unit offers', async () => {
    const transport = transportWith(() => SEARCH_FIXTURE);
    const registry = new ConnectorRegistry().register(connectorWith(authWith(credentials())));
    const { deps } = harness();

    const result = await runResearch(deps, registry, transport.ctx, {
      clientId: 'tenant-1',
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 12 },
    });

    expect(result.status).toBe('COMPLETED');
    const fardo = result.offers.find((offer) => offer.title.includes('Fardo'));
    expect(fardo).toMatchObject({ packQuantity: 12, unitPriceCents: 350, rank: 1 });
    const single = result.offers.find((offer) => offer.supplierName === 'DISTRIBUIDORA SANTOS');
    expect(single?.unitPriceCents).toBe(449);
  });

  it('completes the run with a degraded source when auth fails persistently', async () => {
    const transport = transportWith(() => SEARCH_FIXTURE);
    const registry = new ConnectorRegistry().register(connectorWith(authWith(null)));
    const { store, deps } = harness();

    const result = await runResearch(deps, registry, transport.ctx, {
      clientId: 'tenant-1',
      requestId: 'req-1',
      query: { term: 'Coca-Cola Lata 350ml', quantity: 1 },
    });

    expect(result.status).toBe('COMPLETED');
    expect(result.sourceStats[0]?.status).toBe('FAILED');
    expect(store.degraded).toHaveLength(1);
    expect(store.sources[0]?.status).toBe('DEGRADED');
  });
});
