import { describe, expect, it } from 'vitest';
import { createSerpConnector, parseSerpResponse } from '../connectors/serp';
import { regionToLocation } from '../connectors/serp-location';
import type { ConnectorContext } from '../connectors/types';
import { silentLogger } from '../memory';
import type { SourceRecord } from '../types';

// Shape mirrors a SearchApi.io `google_shopping` response for a gl=br query
// (documented response reference, 2026-07), trimmed to the fields the parser
// reads plus typical noise. NOT captured live — tests never call the vendor.
const SEARCHAPI_FIXTURE = {
  search_metadata: { id: 'search_x1', status: 'Success' },
  search_parameters: {
    engine: 'google_shopping',
    q: 'Guaraná Antarctica 350ml',
    gl: 'br',
    hl: 'pt-BR',
  },
  shopping_results: [
    {
      position: 1,
      product_id: '1111111111111111111',
      title: 'Refrigerante Guaraná Antarctica Lata 350ml',
      product_link: 'https://www.google.com.br/shopping/product/1111111111111111111',
      link: 'https://www.atacadao.com.br/guarana-antarctica-lata-350ml/p',
      seller: 'Atacadão',
      price: 'R$ 3,49',
      extracted_price: 3.49,
      delivery: 'Retirada na loja',
      thumbnail: 'https://encrypted-tbn0.gstatic.com/shopping?q=guarana350',
    },
    {
      position: 2,
      product_id: '2222222222222222222',
      title: 'Guaraná Antarctica 350ml Fardo 12 Latas',
      product_link: 'https://www.google.com.br/shopping/product/2222222222222222222',
      seller: 'Mercado Livre',
      // No extracted_price: the parser must fall back to the price string.
      price: 'R$ 41,90',
      delivery: 'Frete grátis',
    },
    {
      position: 3,
      product_id: '3333333333333333333',
      title: 'Guarana Antarctica Soda 12-pack imported',
      product_link: 'https://www.google.com.br/shopping/product/3333333333333333333',
      seller: 'US Import Store',
      price: '$24.99',
      extracted_price: 24.99,
    },
    {
      position: 4,
      product_id: '4444444444444444444',
      title: 'Guaraná Antarctica 350ml unidade',
      product_link: 'https://www.google.com.br/shopping/product/4444444444444444444',
      seller: 'Loja sem preço',
      // Neither price nor availability signal: must be discarded.
      delivery: 'Consulte o frete',
    },
    {
      position: 5,
      product_id: '5555555555555555555',
      title: 'Guaraná Antarctica Zero Lata 350ml',
      product_link: 'https://www.google.com.br/shopping/product/5555555555555555555',
      seller: 'Empório BR',
      // No price fields at all — but the extensions carry a detected one.
      extensions: ['R$ 3,79 em 12x', 'Em estoque'],
    },
  ],
};

const source = (config: Record<string, unknown> = {}): SourceRecord => ({
  id: 'serp-1',
  clientId: 'tenant-1',
  type: 'SERP',
  name: 'Busca web',
  config,
  enabled: true,
  status: 'ACTIVE',
});

const ctxWith = (
  responder: (url: string) => unknown | null,
  seen: { url: string; headers?: Record<string, string> }[] = [],
): ConnectorContext => ({
  logger: silentLogger,
  fetchJson: (url, init) => {
    seen.push({ url, headers: init?.headers });
    return Promise.resolve(responder(url));
  },
});

const serpConnector = () => createSerpConnector({ getApiKey: () => 'test-key' });

describe('parseSerpResponse', () => {
  it('extracts BRL offers through the price waterfall, merchant as supplier', () => {
    const offers = parseSerpResponse(SEARCHAPI_FIXTURE);
    expect(offers).toHaveLength(3);
    // extracted_price wins when present.
    expect(offers[0]).toMatchObject({
      supplierName: 'Atacadão',
      title: 'Refrigerante Guaraná Antarctica Lata 350ml',
      priceCents: 349,
      currency: 'BRL',
      url: 'https://www.atacadao.com.br/guarana-antarctica-lata-350ml/p',
      imageUrl: 'https://encrypted-tbn0.gstatic.com/shopping?q=guarana350',
    });
    // price-string fallback, with the Google product page as the deep link.
    expect(offers[1]).toMatchObject({
      supplierName: 'Mercado Livre',
      priceCents: 4190,
      url: 'https://www.google.com.br/shopping/product/2222222222222222222',
    });
    // extensions fallback, including the availability signal they carry.
    expect(offers[2]).toMatchObject({
      supplierName: 'Empório BR',
      priceCents: 379,
      availability: 'IN_STOCK',
    });
  });

  // FUT-518: the `delivery` string was already parsed here, but only ever for
  // its availability signal — so every Google Shopping offer reported unknown
  // shipping while carrying a merchant statement about it.
  it('reads shipping from the delivery line, and from nothing else', () => {
    const offers = parseSerpResponse(SEARCHAPI_FIXTURE);
    // "Frete grátis" is a stated price of zero, not an absence of one.
    expect(offers[1]?.shippingCents).toBe(0);
    // "Retirada na loja" is a collection option, not a freight quote.
    expect(offers[0]?.shippingCents).toBeUndefined();
    // The ONLY R$ amount on this row lives in `extensions` ("R$ 3,79 em 12x"),
    // which is an installment price — and it still reaches the price waterfall
    // as 379 cents. Freight must stay unknown: reading that number here would
    // report a financing term as a shipping cost the merchant never quoted.
    expect(offers[2]).toMatchObject({ priceCents: 379 });
    expect(offers[2]?.shippingCents).toBeUndefined();
  });

  it('parses a quoted freight amount and leaves a delivery-time promise unknown', () => {
    const priced = { price: 'R$ 10,00', extracted_price: 10 };
    const offers = parseSerpResponse({
      shopping_results: [
        { title: 'A', seller: 'X', ...priced, delivery: 'Frete: R$ 12,90' },
        { title: 'B', seller: 'Y', ...priced, delivery: 'Entrega em 2 dias' },
        { title: 'C', seller: 'Z', ...priced, delivery: 'Entrega grátis' },
      ],
    });
    expect(offers.map((offer) => offer.shippingCents)).toEqual([1290, undefined, 0]);
    // The delivery line keeps feeding availability exactly as before.
    expect(offers.map((offer) => offer.availability)).toEqual([undefined, undefined, undefined]);
  });

  it('drops non-BRL results and results with neither price nor availability', () => {
    const offers = parseSerpResponse(SEARCHAPI_FIXTURE);
    const suppliers = offers.map((offer) => offer.supplierName);
    expect(suppliers).not.toContain('US Import Store');
    expect(suppliers).not.toContain('Loja sem preço');
  });

  it('drops an explicit non-BRL currency field even when the price text is bare', () => {
    const offers = parseSerpResponse({
      shopping_results: [
        { title: 'Import', seller: 'X', price: '24,99', extracted_price: 24.99, currency: 'USD' },
      ],
    });
    expect(offers).toEqual([]);
  });

  it('keeps unknown payload fields in raw for offline replay', () => {
    const offers = parseSerpResponse(SEARCHAPI_FIXTURE);
    const raw = offers[0]?.raw as Record<string, unknown>;
    expect(raw.position).toBe(1);
    expect(raw.product_id).toBe('1111111111111111111');
  });

  it('tolerates unexpected payload shapes by returning no offers', () => {
    expect(parseSerpResponse(null)).toEqual([]);
    expect(parseSerpResponse([])).toEqual([]);
    expect(parseSerpResponse({ error: 'weird' })).toEqual([]);
  });
});

describe('regionToLocation', () => {
  // FUT-518: a state name prices Belo Horizonte and a town 600 km away inside
  // Minas Gerais identically. A capital's CEP block is contiguous, so those
  // buyers can be named exactly — the ticket's own example is the first case.
  it('maps a capital CEP to the city, not just the state', () => {
    expect(regionToLocation('31610-000')).toBe('Belo Horizonte,State of Minas Gerais,Brazil');
    expect(regionToLocation('01310-100')).toBe('Sao Paulo,State of Sao Paulo,Brazil');
    expect(regionToLocation('20040002')).toBe('Rio de Janeiro,State of Rio de Janeiro,Brazil');
    expect(regionToLocation('90010-000')).toBe('Porto Alegre,State of Rio Grande do Sul,Brazil');
    expect(regionToLocation('80010-000')).toBe('Curitiba,State of Parana,Brazil');
  });

  it('falls back to the state for a CEP outside every capital block', () => {
    // Uberlandia (MG) and Campinas (SP) are not capitals and have no entry:
    // they must keep exactly the answer they had before the city table.
    expect(regionToLocation('38400-100')).toBe('State of Minas Gerais,Brazil');
    expect(regionToLocation('13010-000')).toBe('State of Sao Paulo,Brazil');
    // One past the end of a capital block is the neighbouring municipality,
    // which the table does not name — the state answer is the honest one.
    expect(regionToLocation('32000-000')).toBe('State of Minas Gerais,Brazil');
    expect(regionToLocation('06000-000')).toBe('State of Sao Paulo,Brazil');
    // The Federal District is a single municipality, so its state row is
    // already city-precise and carries no separate capital entry.
    expect(regionToLocation('70040-010')).toBe('Federal District,Brazil');
  });

  it('passes a non-CEP region through and keeps absence absent', () => {
    expect(regionToLocation('Sao Paulo,State of Sao Paulo,Brazil')).toBe(
      'Sao Paulo,State of Sao Paulo,Brazil',
    );
    expect(regionToLocation(undefined)).toBeUndefined();
    expect(regionToLocation('  ')).toBeUndefined();
  });
});

describe('createSerpConnector', () => {
  it('pins Brazil params and localizes from the query CEP, key in the header only', async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    const result = await serpConnector().search(
      { term: 'Guaraná Antarctica 350ml', quantity: 12, region: '01310-100' },
      source(),
      ctxWith(() => SEARCHAPI_FIXTURE, seen),
    );
    expect(result.ok).toBe(true);
    const url = new URL(seen[0]!.url);
    expect(url.origin + url.pathname).toBe('https://www.searchapi.io/api/v1/search');
    expect(url.searchParams.get('engine')).toBe('google_shopping');
    expect(url.searchParams.get('q')).toBe('Guaraná Antarctica 350ml');
    expect(url.searchParams.get('gl')).toBe('br');
    expect(url.searchParams.get('hl')).toBe('pt-BR');
    // FUT-518 inverted this assertion. `google_domain` was sent on every PAID
    // call and SearchApi's google_shopping docs have recorded it deprecated
    // since 2025-04-15 — Google redirects ccTLDs like google.com.br to
    // google.com, so gl/hl above are the whole Brazil pin. Its ABSENCE is now
    // the thing under test, so the parameter cannot quietly come back.
    expect(url.searchParams.has('google_domain')).toBe(false);
    expect(url.searchParams.get('location')).toBe('Sao Paulo,State of Sao Paulo,Brazil');
    expect(url.searchParams.get('api_key')).toBeNull();
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
  });

  it('prefixes a brand the term is missing and prefers a configured location', async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    await serpConnector().search(
      { term: 'Refrigerante 350ml', brand: 'Antarctica', quantity: 1, region: '01310-100' },
      source({ location: 'Campinas,State of Sao Paulo,Brazil' }),
      ctxWith(() => SEARCHAPI_FIXTURE, seen),
    );
    const url = new URL(seen[0]!.url);
    expect(url.searchParams.get('q')).toBe('Antarctica Refrigerante 350ml');
    expect(url.searchParams.get('location')).toBe('Campinas,State of Sao Paulo,Brazil');
  });

  it('reports a missing API key as a connector error, never throws', async () => {
    const keyless = createSerpConnector({ getApiKey: () => undefined });
    const seen: { url: string }[] = [];
    const result = await keyless.search(
      { term: 'Guaraná Antarctica 350ml', quantity: 1 },
      source(),
      ctxWith(() => SEARCHAPI_FIXTURE, seen),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // FUT-517 inverted this assertion. The env var is a PLATFORM-operator
      // fact and this sentence is rendered to a tenant admin, who has no shell
      // to set one in — so its absence is now the thing under test.
      expect(result.error).not.toContain('SEARCHAPI_API_KEY');
      expect(result.error).toContain('chave de API não configurada');
      expect(result.error).toContain('google_shopping');
    }
    expect(seen).toHaveLength(0);
  });

  it('runs on the tenant credential from source.config even without a host env key', async () => {
    const keyless = createSerpConnector({ getApiKey: () => undefined });
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    const result = await keyless.search(
      { term: 'Guaraná Antarctica 350ml', quantity: 1 },
      source({ credentials: { apiKey: 'sk-tenant-serp-1234' } }),
      ctxWith(() => SEARCHAPI_FIXTURE, seen),
    );
    expect(result.ok).toBe(true);
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer sk-tenant-serp-1234' });
  });

  it('prefers the tenant credential over the host env key when both exist', async () => {
    const seen: { url: string; headers?: Record<string, string> }[] = [];
    await serpConnector().search(
      { term: 'Guaraná Antarctica 350ml', quantity: 1 },
      source({ credentials: { apiKey: 'sk-tenant-serp-1234' } }),
      ctxWith(() => SEARCHAPI_FIXTURE, seen),
    );
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer sk-tenant-serp-1234' });
  });

  it('reports an unreachable vendor as a connector error', async () => {
    const result = await serpConnector().search(
      { term: 'Guaraná Antarctica 350ml', quantity: 1 },
      source(),
      ctxWith(() => null),
    );
    // An `fetchJson`-only host has no reason to give (FUT-495/502): the failure
    // is reported as an undetermined connection failure — and NOT as a timeout,
    // which this transport tier genuinely cannot tell.
    expect(result).toEqual({
      ok: false,
      error: 'SearchApi google_shopping: falha de conexão com o provedor (rede, DNS ou TLS)',
    });
  });

  it('surfaces a vendor-reported error body as a connector error', async () => {
    const result = await serpConnector().search(
      { term: 'Guaraná Antarctica 350ml', quantity: 1 },
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
    const result = await serpConnector().search(
      { term: 'Guaraná Antarctica 350ml', quantity: 1 },
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

  it('says the provider gave no reason when its error body is blank', async () => {
    const result = await serpConnector().search(
      { term: 'Guaraná Antarctica 350ml', quantity: 1 },
      source(),
      ctxWith(() => ({ error: '   ' })),
    );
    expect(result).toEqual({
      ok: false,
      error: 'SearchApi google_shopping: o provedor recusou a consulta sem informar o motivo',
    });
  });

  it('reports an invalid config in pt-BR, without the zod English or the raw value', async () => {
    const seen: { url: string }[] = [];
    const result = await serpConnector().search(
      { term: 'Guaraná Antarctica 350ml', quantity: 1 },
      source({ location: 42 }),
      ctxWith(() => SEARCHAPI_FIXTURE, seen),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Configuração da fonte');
      // The field PATH is the whole actionable diagnostic; zod's own sentence
      // is English and quotes the offending value, which can be a credential.
      expect(result.error).toContain('location');
      expect(result.error).not.toContain('Invalid');
      expect(result.error).not.toContain('expected');
    }
    expect(seen).toHaveLength(0);
  });
});
