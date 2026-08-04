import { describe, expect, it } from 'vitest';
import { parseVtexResponse, salesChannelFor, vtexConnector } from '../connectors/vtex';
import type { ConnectorContext, FetchOutcome } from '../connectors/types';
import { silentLogger } from '../memory';
import type { LoggerPort } from '../ports';
import type { SourceRecord } from '../types';
import { GIGA_FIXTURE } from './fixtures/giga-atacado';
import {
  ATACADAO_IS_RIO,
  ATACADAO_IS_SAO_PAULO,
  GIGA_REGIONS_NO_SELLERS,
  GIGA_REGIONS_SERVED,
} from './fixtures/vtex-regions';

const source = (config: Record<string, unknown>): SourceRecord => ({
  id: 'giga-1',
  clientId: 'tenant-1',
  type: 'VTEX',
  name: 'Giga Atacado',
  config,
  enabled: true,
  status: 'ACTIVE',
});

const ctxWith = (
  responder: (url: string) => unknown | null,
  seen: string[] = [],
): ConnectorContext => ({
  logger: silentLogger,
  fetchJson: (url) => {
    seen.push(url);
    return Promise.resolve(responder(url));
  },
});

describe('vtexConnector', () => {
  it('parses products into raw offers, excluding out-of-stock SKUs', () => {
    const offers = parseVtexResponse(GIGA_FIXTURE, source({}), 'https://www.giga.com.vc');
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      supplierName: 'Giga Atacado',
      title: 'Coca-Cola Original 350Ml',
      ean: '7894900011517',
      priceCents: 359,
      currency: 'BRL',
      availability: 'IN_STOCK',
      url: 'https://www.giga.com.vc/coca-cola-original-350ml/p',
      imageUrl: 'https://giga.vteximg.com.br/arquivos/ids/1/coca350.png',
    });
    expect(offers[1]?.priceCents).toBe(1199);
    expect(offers[1]?.url).toBe('https://www.giga.com.vc/refrigerante-coca-cola-pet-25l/p');
  });

  it('searches by full text with brand + term and sales channel', async () => {
    const seen: string[] = [];
    const result = await vtexConnector.search(
      { term: 'Coca-Cola Lata 350ml', brand: 'Coca-Cola', quantity: 12 },
      source({ baseUrl: 'https://www.giga.com.vc', salesChannel: 1 }),
      ctxWith(() => GIGA_FIXTURE, seen),
    );
    expect(result.ok).toBe(true);
    expect(seen[0]).toBe(
      'https://www.giga.com.vc/api/catalog_system/pub/products/search?ft=Coca-Cola%20Lata%20350ml&sc=1',
    );
  });

  it('prefers EAN lookup and falls back to text search when it finds nothing', async () => {
    const seen: string[] = [];
    const result = await vtexConnector.search(
      { term: 'Coca-Cola Lata 350ml', ean: '7894900011517', quantity: 1 },
      source({ baseUrl: 'https://www.giga.com.vc' }),
      ctxWith((url) => (url.includes('alternateIds_Ean') ? [] : GIGA_FIXTURE), seen),
    );
    expect(seen[0]).toContain('fq=alternateIds_Ean:7894900011517');
    expect(seen[1]).toContain('ft=');
    expect(result.ok && result.offers).toHaveLength(2);
  });

  it('keeps unknown payload fields in raw for offline replay', () => {
    const offers = parseVtexResponse(GIGA_FIXTURE, source({}), 'https://www.giga.com.vc');
    const raw = offers[0]?.raw as Record<string, unknown>;
    expect(raw.productId).toBe('5613');
    expect(raw.categories).toEqual(['/Bebidas/Refrigerantes/']);
    expect((raw.items as Record<string, unknown>[])[0]?.itemId).toBe('5613');
  });

  it('surfaces a fallback outage as an error, not an empty success', async () => {
    const result = await vtexConnector.search(
      { term: 'Coca-Cola Lata 350ml', ean: '7894900011517', quantity: 1 },
      source({ baseUrl: 'https://www.giga.com.vc' }),
      ctxWith((url) => (url.includes('alternateIds_Ean') ? [] : null)),
    );
    expect(result.ok).toBe(false);
    // Still an outage — and since FUT-495 it says which tier and why.
    if (!result.ok) expect(result.error).toContain('Busca no catálogo VTEX falhou');
  });

  it('reports an unreachable store as a connector error, never throws', async () => {
    const result = await vtexConnector.search(
      { term: 'Coca-Cola', quantity: 1 },
      source({ baseUrl: 'https://www.giga.com.vc' }),
      ctxWith(() => null),
    );
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining('falha de conexão com a loja'),
    });
  });

  it('rejects an invalid config with a clear error', async () => {
    const result = await vtexConnector.search(
      { term: 'Coca-Cola', quantity: 1 },
      source({}),
      ctxWith(() => GIGA_FIXTURE),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('invalid VTEX config');
  });

  it('tolerates unexpected payload shapes by returning no offers', () => {
    expect(parseVtexResponse({ error: 'weird' }, source({}), 'https://x.example')).toEqual([]);
    expect(parseVtexResponse(null, source({}), 'https://x.example')).toEqual([]);
  });

  it('routes a mapped region to its sales channel — the request changes with the CEP', async () => {
    const seen: string[] = [];
    await vtexConnector.search(
      { term: 'Coca-Cola Lata 350ml', quantity: 1, region: '20310-050' },
      source({
        baseUrl: 'https://www.giga.com.vc',
        salesChannel: 1,
        regionSalesChannels: { '20': '3', '20310': '4' },
      }),
      ctxWith(() => GIGA_FIXTURE, seen),
    );
    // Longest CEP-prefix match wins: 20310 beats 20.
    expect(seen[0]).toContain('&sc=4');
  });

  it('applies the region channel to the EAN fallback request too', async () => {
    const seen: string[] = [];
    await vtexConnector.search(
      { term: 'Coca-Cola Lata 350ml', ean: '7894900011517', quantity: 1, region: '01310100' },
      source({
        baseUrl: 'https://www.giga.com.vc',
        regionSalesChannels: { '01': '2' },
      }),
      ctxWith((url) => (url.includes('alternateIds_Ean') ? [] : GIGA_FIXTURE), seen),
    );
    expect(seen[0]).toContain('&sc=2');
    expect(seen[1]).toContain('&sc=2');
  });

  it('falls back to the default channel when the region matches no mapping', async () => {
    const seen: string[] = [];
    await vtexConnector.search(
      { term: 'Coca-Cola Lata 350ml', quantity: 1, region: '99999-000' },
      source({
        baseUrl: 'https://www.giga.com.vc',
        salesChannel: 1,
        regionSalesChannels: { '20': '3' },
      }),
      ctxWith(() => GIGA_FIXTURE, seen),
    );
    // An unmapped full CEP first asks the store's regions API (automatic
    // tier); this store answers nonsense for it, so the catalog request then
    // falls back to the default channel.
    expect(seen[0]).toContain('/api/checkout/pub/regions');
    expect(seen[1]).toContain('&sc=1');
  });
});

describe('vtexConnector auto-regionalization', () => {
  const cepQuery = { term: 'Refrigerante Coca-Cola 350ml', quantity: 12, region: '01310-100' };

  /**
   * FUT-514 corrects what FUT-491 built on. A region carrying no sellers is
   * VTEX's "this store does not regionalize by seller", not a refusal to
   * deliver, so this arm must make NO delivery claim: unflagged default-region
   * offers. Reading it as a refusal is what badged every offer of every such
   * store "fora da área de entrega", including ones the buyer could order.
   *
   * A host with no `postJsonResult` cannot ask the endpoint that does know, so
   * "no claim" is also the honest answer here.
   */
  it('answers the default-region catalog UNFLAGGED when the store just does not regionalize', async () => {
    const seen: string[] = [];
    const result = await vtexConnector.search(
      { ...cepQuery, region: '20031-000' },
      source({ baseUrl: 'https://www.giga.com.vc', salesChannel: 1 }),
      ctxWith((url) => (url.includes('/pub/regions') ? GIGA_REGIONS_NO_SELLERS : GIGA_FIXTURE), seen),
    );
    expect(result.ok && result.offers).toHaveLength(2);
    expect(result.ok && result.offers.map((offer) => offer.outsideDeliveryArea)).toEqual([
      undefined,
      undefined,
    ]);
    expect(result.ok && result.outsideDeliveryArea).toBeUndefined();
    // The probe still runs first, and the answer comes from the legacy
    // default-channel catalog path — the same one the no-CEP case uses.
    expect(seen[0]).toContain('/api/checkout/pub/regions?country=BRA&postalCode=20031000');
    expect(seen[1]).toContain('/api/catalog_system/pub/products/search?ft=');
    expect(seen[1]).toContain('&sc=1');
  });

  it('leaves the EAN text-fallback offers unflagged too when nothing can judge delivery', async () => {
    const seen: string[] = [];
    const result = await vtexConnector.search(
      { ...cepQuery, region: '20031-000', ean: '7894900011517' },
      source({ baseUrl: 'https://www.giga.com.vc' }),
      ctxWith((url) => {
        if (url.includes('/pub/regions')) return GIGA_REGIONS_NO_SELLERS;
        return url.includes('alternateIds_Ean') ? [] : GIGA_FIXTURE;
      }, seen),
    );
    expect(seen[1]).toContain('fq=alternateIds_Ean:7894900011517');
    expect(seen[2]).toContain('ft=');
    expect(
      result.ok && result.offers.every((offer) => offer.outsideDeliveryArea === undefined),
    ).toBe(true);
  });

  it('keeps an outage on the default-region fallback an outage, not an empty success', async () => {
    const result = await vtexConnector.search(
      { ...cepQuery, region: '20031-000' },
      source({ baseUrl: 'https://www.giga.com.vc' }),
      ctxWith((url) => (url.includes('/pub/regions') ? GIGA_REGIONS_NO_SELLERS : null)),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Busca no catálogo VTEX falhou');
  });

  it('prices a served region through intelligent-search with the region id', async () => {
    const seen: string[] = [];
    const result = await vtexConnector.search(
      cepQuery,
      source({ baseUrl: 'https://www.atacadao.com.br' }),
      ctxWith((url) => {
        if (url.includes('/pub/regions')) return [{ id: 'v2.SP', sellers: [{ id: 'atacadaobr133' }] }];
        if (url.includes('intelligent-search')) return ATACADAO_IS_SAO_PAULO;
        return null;
      }, seen),
    );
    // Slashless canonical path (FUT-416): Atacadão 308s the trailing-slash
    // form, and the transport-level redirect is one avoidable round-trip.
    expect(seen[1]).toContain('/api/io/_v/api/intelligent-search/product_search?query=');
    expect(seen[1]).toContain('regionId=v2.SP');
    expect(result.ok && result.offers.map((offer) => offer.priceCents)).toEqual([379, 367]);
    // Region-priced offers ARE deliverable here — never flagged (FUT-491).
    expect(
      result.ok && result.offers.every((offer) => offer.outsideDeliveryArea === undefined),
    ).toBe(true);
  });

  it('prices the same query differently in another region and drops what it does not sell there', async () => {
    const result = await vtexConnector.search(
      { ...cepQuery, region: '20031-000' },
      source({ baseUrl: 'https://www.atacadao.com.br' }),
      ctxWith((url) => {
        if (url.includes('/pub/regions')) return [{ id: 'v2.RIO', sellers: [{ id: 'atacadaobr249' }] }];
        if (url.includes('intelligent-search')) return ATACADAO_IS_RIO;
        return null;
      }),
    );
    // The Rio fixture prices the same can at R$ 3,99 (São Paulo: R$ 3,79) and
    // answers the Zero SKU as unavailable — it must not be ranked as buyable.
    expect(result.ok && result.offers.map((offer) => offer.priceCents)).toEqual([399]);
  });

  it('falls back to the legacy catalog search when the store has no intelligent-search', async () => {
    const seen: string[] = [];
    const result = await vtexConnector.search(
      cepQuery,
      source({ baseUrl: 'https://www.giga.com.vc', salesChannel: 1 }),
      ctxWith((url) => {
        if (url.includes('/pub/regions')) return GIGA_REGIONS_SERVED;
        if (url.includes('intelligent-search')) return null;
        return GIGA_FIXTURE;
      }, seen),
    );
    expect(result.ok && result.offers).toHaveLength(2);
    expect(seen[2]).toContain('/api/catalog_system/pub/products/search?ft=');
    expect(seen[2]).toContain('&sc=1');
  });

  it('treats a failed regions probe as no regional knowledge — default search', async () => {
    const seen: string[] = [];
    const result = await vtexConnector.search(
      cepQuery,
      source({ baseUrl: 'https://www.giga.com.vc' }),
      ctxWith((url) => (url.includes('/pub/regions') ? null : GIGA_FIXTURE), seen),
    );
    expect(result.ok && result.offers).toHaveLength(2);
    expect(seen[1]).toContain('/api/catalog_system/');
    // Unknown region ⇒ exactly as before FUT-491: legacy offers, UNFLAGGED.
    // "We don't know" is not the claim "the store won't deliver here".
    expect(
      result.ok && result.offers.every((offer) => offer.outsideDeliveryArea === undefined),
    ).toBe(true);
  });

  it('skips the probe for a partial CEP, an explicit mapping, or regionalize: false', async () => {
    const probes: string[] = [];
    const collecting = (url: string) => {
      if (url.includes('/pub/regions')) probes.push(url);
      return GIGA_FIXTURE;
    };
    await vtexConnector.search(
      { ...cepQuery, region: '01' },
      source({ baseUrl: 'https://www.giga.com.vc' }),
      ctxWith(collecting),
    );
    await vtexConnector.search(
      cepQuery,
      source({ baseUrl: 'https://www.giga.com.vc', regionSalesChannels: { '01': '2' } }),
      ctxWith(collecting),
    );
    await vtexConnector.search(
      cepQuery,
      source({ baseUrl: 'https://www.giga.com.vc', regionalize: false }),
      ctxWith(collecting),
    );
    expect(probes).toEqual([]);
  });

  it('rides the EAN through intelligent-search with a text fallback', async () => {
    const seen: string[] = [];
    const result = await vtexConnector.search(
      { ...cepQuery, ean: '7894900010015' },
      source({ baseUrl: 'https://www.atacadao.com.br' }),
      ctxWith((url) => {
        if (url.includes('/pub/regions')) return [{ id: 'v2.SP', sellers: [{ id: 's1' }] }];
        if (url.includes('query=7894900010015')) return { products: [] };
        if (url.includes('intelligent-search')) return ATACADAO_IS_SAO_PAULO;
        return null;
      }, seen),
    );
    expect(seen[1]).toContain('query=7894900010015');
    expect(seen[2]).toContain('intelligent-search');
    expect(result.ok && result.offers.length).toBeGreaterThan(0);
  });

  it('parses the intelligent-search envelope through parseVtexResponse too', () => {
    const offers = parseVtexResponse(ATACADAO_IS_SAO_PAULO, source({}), 'https://www.atacadao.com.br');
    expect(offers.map((offer) => offer.priceCents)).toEqual([379, 367]);
    expect(offers[0]?.url).toBe(
      'https://www.atacadao.com.br/refrigerante-coca-cola-lata-com-350ml-7699/p',
    );
  });
});

/**
 * FUT-495: the recorded error must say WHY. The production case this exists for
 * — tenant future-drink's Atacadão source — showed only "indisponível" over a
 * stored `VTEX catalog search unreachable: <url with ?ft=…>`: the URL proved the
 * guarded transport had followed apex→www, and the ~1.3s failure proved it was
 * not a timeout, yet nothing said whether the store 403'd us, 404'd us, or
 * broke its TLS handshake.
 */
const reasonCtx = (
  responder: (url: string) => FetchOutcome,
  options: { seen?: string[]; logger?: LoggerPort } = {},
): ConnectorContext => ({
  logger: options.logger ?? silentLogger,
  // Present but never used by the connector: `fetchJsonResult` is the richest
  // seam, so `fetchJsonOutcome` must prefer it.
  fetchJson: () => Promise.resolve(null),
  fetchJsonResult: (url) => {
    options.seen?.push(url);
    return Promise.resolve(responder(url));
  },
});

const logCollector = (lines: string[]): LoggerPort => ({
  info: (message) => {
    lines.push(message);
  },
  warn: () => {},
  error: () => {},
});

const CATALOG_QUERY = { term: 'coca cola 220ml', quantity: 12 };
const ATACADAO = { baseUrl: 'https://www.atacadao.com.br' };

describe('vtexConnector failure reasons (FUT-495)', () => {
  it('names a 403 as the store refusing us, and never keeps the query string', async () => {
    const result = await vtexConnector.search(
      CATALOG_QUERY,
      source(ATACADAO),
      reasonCtx(() => ({ ok: false, failure: { kind: 'http', status: 403 } })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Busca no catálogo VTEX falhou');
    expect(result.error).toContain('HTTP 403');
    expect(result.error).toContain('bloqueio de bot');
    // The endpoint stays (it is the diagnostic part); the query goes — it can
    // carry a key, and `?ft=coca%20cola%20220ml` is noise besides.
    expect(result.error).toContain(
      'https://www.atacadao.com.br/api/catalog_system/pub/products/search',
    );
    expect(result.error).not.toContain('?');
  });

  it('tells a 404, a 429 and a 5xx apart', async () => {
    const errorFor = async (status: number): Promise<string> => {
      const result = await vtexConnector.search(
        CATALOG_QUERY,
        source(ATACADAO),
        reasonCtx(() => ({ ok: false, failure: { kind: 'http', status } })),
      );
      return result.ok ? '' : result.error;
    };

    expect(await errorFor(404)).toContain('não existe na loja');
    expect(await errorFor(429)).toContain('limitou nossa taxa');
    expect(await errorFor(503)).toContain('erro interno');
  });

  it('reports a timeout as a timeout, not as a generic failure', async () => {
    const result = await vtexConnector.search(
      CATALOG_QUERY,
      source(ATACADAO),
      reasonCtx(() => ({ ok: false, failure: { kind: 'timeout' } })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('não respondeu dentro do tempo limite');
  });

  it('reports a transport failure with the host code it could determine', async () => {
    const result = await vtexConnector.search(
      CATALOG_QUERY,
      source(ATACADAO),
      reasonCtx(() => ({ ok: false, failure: { kind: 'transport', code: 'CERT_HAS_EXPIRED' } })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('falha de conexão com a loja');
      expect(result.error).toContain('CERT_HAS_EXPIRED');
    }
  });

  it('reports an unresolvable domain as a URL typo, not as a connection failure', async () => {
    // The commonest real misconfiguration. `DNS_UNRESOLVED` (the guard could not
    // resolve the host) and `ENOTFOUND` (the socket could not) are the same
    // problem for the operator, and the fix is their own URL field.
    for (const code of ['DNS_UNRESOLVED', 'ENOTFOUND']) {
      const result = await vtexConnector.search(
        CATALOG_QUERY,
        source(ATACADAO),
        reasonCtx(() => ({ ok: false, failure: { kind: 'transport', code } })),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('domínio da loja não foi encontrado');
        expect(result.error).toContain('confira o endereço');
        expect(result.error).not.toContain(code);
      }
    }
  });

  it('reports a 200 that is not JSON as an error/blocking page', async () => {
    const result = await vtexConnector.search(
      CATALOG_QUERY,
      source(ATACADAO),
      reasonCtx(() => ({ ok: false, failure: { kind: 'body', status: 200 } })),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('não em JSON');
  });

  it('logs the REGIONS tier by name and still falls back to the catalog search', async () => {
    const lines: string[] = [];
    const result = await vtexConnector.search(
      { ...CATALOG_QUERY, region: '01310-100' },
      source(ATACADAO),
      reasonCtx(
        (url) =>
          url.includes('/pub/regions')
            ? { ok: false, failure: { kind: 'http', status: 403 } }
            : { ok: true, payload: GIGA_FIXTURE },
        { logger: logCollector(lines) },
      ),
    );

    // A probe that fails is still "no regional knowledge" — never a refusal to
    // serve — so the offers come back UNFLAGGED, exactly as before FUT-495.
    expect(result.ok && result.offers).toHaveLength(2);
    expect(result.ok && result.offers.every((offer) => offer.outsideDeliveryArea === undefined)).toBe(
      true,
    );
    expect(lines.some((line) => line.startsWith('Consulta de regiões VTEX falhou'))).toBe(true);
    expect(lines.some((line) => line.includes('HTTP 403'))).toBe(true);
  });

  it('logs the INTELLIGENT-SEARCH tier by name, distinct from the catalog tier', async () => {
    const lines: string[] = [];
    const result = await vtexConnector.search(
      { ...CATALOG_QUERY, region: '01310-100' },
      source(ATACADAO),
      reasonCtx((url) => {
        if (url.includes('/pub/regions')) {
          return { ok: true, payload: [{ id: 'v2.SP', sellers: [{ id: 'atacadaobr133' }] }] };
        }
        if (url.includes('intelligent-search')) {
          return { ok: false, failure: { kind: 'http', status: 403 } };
        }
        return { ok: true, payload: GIGA_FIXTURE };
      }, { logger: logCollector(lines) }),
    );

    expect(result.ok && result.offers).toHaveLength(2);
    expect(lines.some((line) => line.startsWith('Busca inteligente VTEX falhou'))).toBe(true);
    expect(lines.some((line) => line.startsWith('Consulta de regiões VTEX falhou'))).toBe(false);
  });

  it('falls back to fetchJsonStatus on a host without the reason seam', async () => {
    const result = await vtexConnector.search(
      CATALOG_QUERY,
      source(ATACADAO),
      {
        logger: silentLogger,
        fetchJson: () => Promise.resolve(null),
        fetchJsonStatus: () => Promise.resolve({ status: 403, payload: null }),
      },
    );

    // Less precise transports still get the status through — a 403 must never
    // read like an outage just because the host predates `fetchJsonResult`.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('HTTP 403');
  });

  const withSimulation = (payload: unknown): ConnectorContext => ({
    ...reasonCtx((url) =>
      url.includes('/pub/regions')
        ? { ok: true, payload: GIGA_REGIONS_NO_SELLERS }
        : { ok: true, payload: GIGA_FIXTURE },
    ),
    postJsonResult: () => Promise.resolve({ ok: true, payload }),
  });

  it('flags exactly the SKUs the simulation will not deliver', async () => {
    const result = await vtexConnector.search(
      { ...CATALOG_QUERY, region: '31610-000' },
      source(ATACADAO),
      withSimulation({
        items: [{ id: '5613' }, { id: '9911' }],
        logisticsInfo: [{ slas: [{}, {}] }, { slas: [] }],
      }),
    );

    expect(result.ok && result.offers.map((offer) => offer.outsideDeliveryArea)).toEqual([
      undefined,
      true,
    ]);
  });

  /**
   * On the WRONG sales channel the simulation answers "não tem estoque" for
   * every CEP, including ones the store demonstrably serves — the same
   * all-undeliverable shape a genuinely unreachable CEP produces. Flagging on
   * that would rebuild the FUT-514 defect behind a new endpoint, so an answer
   * that discriminates nothing claims nothing.
   */
  it('makes NO claim when the simulation delivers nothing at all', async () => {
    const lines: string[] = [];
    const result = await vtexConnector.search(
      { ...CATALOG_QUERY, region: '20031-000' },
      source(ATACADAO),
      {
        ...withSimulation({
          items: [{ id: '5613' }, { id: '9911' }],
          logisticsInfo: [{ slas: [] }, { slas: [] }],
        }),
        logger: logCollector(lines),
      },
    );

    expect(result.ok && result.offers.every((offer) => offer.outsideDeliveryArea === undefined)).toBe(
      true,
    );
    expect(result.ok && result.outsideDeliveryArea).toBeUndefined();
    // Silently claiming nothing would hide a misconfigured channel forever.
    expect(lines.some((line) => line.includes('salesChannel'))).toBe(true);
  });

  /**
   * FUT-516's central claim, pinned: `vtexConnector` needs NO change for the
   * per-source ceiling. The ceiling lands on the `ConnectorContext` seams, and
   * a refused seam is something this connector ALREADY handles — the same path
   * a host that mounts no `postJsonResult` at all takes — so it unwinds, keeps
   * every offer it had, and makes no delivery claim it did not earn.
   *
   * What this guards against is the FUT-514 defect returning through the
   * ceiling: a cut search whose catalog offers LOOK verified.
   */
  it('keeps its catalog offers unflagged when the deadline refuses the delivery POST', async () => {
    const result = await vtexConnector.search(
      { ...CATALOG_QUERY, region: '31610-000' },
      source(ATACADAO),
      {
        ...withSimulation({ items: [], logisticsInfo: [] }),
        postJsonResult: () => Promise.resolve({ ok: false, failure: { kind: 'deadline' } }),
      },
    );

    expect(result.ok).toBe(true);
    // Every offer the catalog tiers already found survives the cut…
    expect(result.ok && result.offers.length).toBeGreaterThan(0);
    // …and not one carries a delivery verdict we never obtained.
    expect(
      result.ok && result.offers.every((offer) => offer.outsideDeliveryArea === undefined),
    ).toBe(true);
    expect(result.ok && result.outsideDeliveryArea).toBeUndefined();
  });
});

describe('salesChannelFor', () => {
  const config = { baseUrl: 'https://www.giga.com.vc' };

  it('is undefined with no default and no mapping — store default pricing', () => {
    expect(salesChannelFor(config, '20310-050')).toBeUndefined();
    expect(salesChannelFor(config)).toBeUndefined();
  });

  it('normalizes digits on both sides of the prefix match', () => {
    expect(
      salesChannelFor(
        { ...config, regionSalesChannels: { '20-3': '7' } },
        '20.310-050',
      ),
    ).toBe('7');
  });

  it('ignores the mapping when the query has no region', () => {
    expect(
      salesChannelFor({ ...config, salesChannel: 1, regionSalesChannels: { '20': '3' } }),
    ).toBe('1');
  });
});

/**
 * FUT-520: the optional application key. The two assertions that matter are
 * opposite in shape — a keyed source must send the headers on EVERY tier (one
 * forgotten tier degrades silently, under a different identity than the rest),
 * and an unkeyed source must be byte-identical to what it was before the
 * feature existed. Nothing about the URLs changes either way: the key is not a
 * route to a different endpoint.
 */
describe('vtexConnector application key (FUT-520)', () => {
  const APP_KEY = 'vtexappkey-atacadao-ABCDEF';
  const APP_TOKEN = 'PZWKPYWXQAOPJDLBFMAAGXLWRTJDNRQFMBAAAOSGDKHVOOJKYA';
  const AUTH_HEADERS = { 'X-VTEX-API-AppKey': APP_KEY, 'X-VTEX-API-AppToken': APP_TOKEN };

  const KEYED_QUERY = { term: 'coca cola 220ml', quantity: 12, region: '31610-000' };

  interface Exchange {
    url: string;
    headers?: Record<string, string>;
    credentialsRequired?: boolean;
  }

  /** Every tier of one search, recorded with the init it actually ran under. */
  const tieredCtx = (calls: Exchange[]): ConnectorContext => ({
    logger: silentLogger,
    fetchJson: () => Promise.resolve(null),
    fetchJsonResult: (url, init) => {
      calls.push({ url, headers: init?.headers, credentialsRequired: init?.credentialsRequired });
      if (url.includes('/pub/regions')) {
        return Promise.resolve({
          ok: true,
          payload: [{ id: 'v2.MG', sellers: [{ id: 'atacadaobr133' }] }],
        });
      }
      if (url.includes('intelligent-search')) {
        return Promise.resolve({ ok: true, payload: ATACADAO_IS_SAO_PAULO });
      }
      return Promise.resolve({ ok: true, payload: GIGA_FIXTURE });
    },
    postJsonResult: (url, _body, init) => {
      calls.push({ url, headers: init?.headers, credentialsRequired: init?.credentialsRequired });
      return Promise.resolve({ ok: true, payload: { items: [], logisticsInfo: [] } });
    },
  });

  const keyedSource = (config: Record<string, unknown> = ATACADAO): SourceRecord =>
    source({ ...config, credentials: { appKey: APP_KEY, appToken: APP_TOKEN } });

  it('sends the headers on the regions probe, intelligent-search AND the delivery POST', async () => {
    const calls: Exchange[] = [];
    await vtexConnector.search(KEYED_QUERY, keyedSource(), tieredCtx(calls));

    // All three network tiers a regionalized search touches, in order.
    expect(calls.map((call) => call.url.split('?')[0])).toEqual([
      'https://www.atacadao.com.br/api/checkout/pub/regions',
      'https://www.atacadao.com.br/api/io/_v/api/intelligent-search/product_search',
      'https://www.atacadao.com.br/api/checkout/pub/orderForms/simulation',
    ]);
    for (const call of calls) {
      expect(call.headers).toEqual(AUTH_HEADERS);
      expect(call.credentialsRequired).toBe(true);
    }
  });

  it('sends them on the legacy catalog tier and its EAN text fallback too', async () => {
    const calls: Exchange[] = [];
    const ctx = tieredCtx(calls);
    await vtexConnector.search(
      { term: 'coca cola 220ml', quantity: 12, ean: '7894900011517' },
      keyedSource(),
      {
        ...ctx,
        fetchJsonResult: (url, init) => {
          calls.push({ url, headers: init?.headers, credentialsRequired: init?.credentialsRequired });
          return Promise.resolve({
            ok: true,
            payload: url.includes('alternateIds_Ean') ? [] : GIGA_FIXTURE,
          });
        },
      },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain('fq=alternateIds_Ean:');
    expect(calls[1]?.url).toContain('ft=');
    for (const call of calls) expect(call.headers).toEqual(AUTH_HEADERS);
  });

  it('leaves the URLs identical to the unkeyed search — the key is never in one', async () => {
    const keyed: Exchange[] = [];
    const unkeyed: Exchange[] = [];
    await vtexConnector.search(KEYED_QUERY, keyedSource(), tieredCtx(keyed));
    await vtexConnector.search(KEYED_QUERY, source(ATACADAO), tieredCtx(unkeyed));

    expect(keyed.map((call) => call.url)).toEqual(unkeyed.map((call) => call.url));
    for (const call of keyed) {
      expect(call.url).not.toContain(APP_KEY);
      expect(call.url).not.toContain(APP_TOKEN);
      // No `pvt` detour: a keyed source keeps the public storefront endpoints,
      // which are the only ones the parser, FUT-416 pricing and FUT-514
      // delivery all speak.
      expect(call.url).not.toContain('/pvt/');
    }
  });

  it('sends NO auth init at all for an unkeyed source', async () => {
    const calls: Exchange[] = [];
    await vtexConnector.search(KEYED_QUERY, source(ATACADAO), tieredCtx(calls));

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.headers).toBeUndefined();
      expect(call.credentialsRequired).toBeUndefined();
    }
  });

  it('ignores a half-configured pair rather than sending one header', async () => {
    const calls: Exchange[] = [];
    await vtexConnector.search(
      KEYED_QUERY,
      source({ ...ATACADAO, credentials: { appKey: APP_KEY } }),
      tieredCtx(calls),
    );

    for (const call of calls) expect(call.headers).toBeUndefined();
  });

  it('blames the key as well as the edge when a KEYED catalog request is refused', async () => {
    const result = await vtexConnector.search(
      CATALOG_QUERY,
      keyedSource(),
      reasonCtx(() => ({ ok: false, failure: { kind: 'http', status: 403 } })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('chave de aplicação da fonte');
    expect(result.error).not.toContain(APP_KEY);
    expect(result.error).not.toContain(APP_TOKEN);
  });

  it('renders the stripped-credential refusal as its own reason, not a network failure', async () => {
    // The host refuses to continue a keyed walk across a host change. Read as a
    // generic transport failure it would say "falha de conexão com a loja" for a
    // request we deliberately never sent.
    const result = await vtexConnector.search(
      CATALOG_QUERY,
      keyedSource(),
      reasonCtx(() => ({
        ok: false,
        failure: { kind: 'transport', code: 'CREDENTIALS_STRIPPED' },
      })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('redireciona para outro endereço');
    expect(result.error).toContain('www');
    expect(result.error).not.toContain('rede, DNS ou TLS');
  });
});
