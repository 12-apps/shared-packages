import { describe, expect, it, vi } from 'vitest';

import {
  createApiProductResearch,
  type ResearchApiConfig,
  type ResearchHttpStore,
  type ResearchRoute,
} from '../http';
import { EN_US_RESEARCH_DIAGNOSTICS, EN_US_RESEARCH_MESSAGES } from '../en-US';
import { PT_BR_RESEARCH_DIAGNOSTICS, PT_BR_RESEARCH_MESSAGES } from '../pt-BR';
import { PT_BR_MARKET_VOCABULARY } from '../normalize/pt-BR';

/**
 * The sixteen descriptors, driven the way a host adapter drives them. The
 * package owns paths, envelopes, statuses and ordering (SSRF veto before
 * probe before write); the host owns storage, probes, encryption and words —
 * so every test binds fakes for those and asserts what crossed the seam.
 */

function fakeStore(): ResearchHttpStore & {
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {};
  const record = (name: string, args: unknown): void => {
    (calls[name] ??= []).push(args);
  };
  return {
    calls,
    requests: {
      create: async (clientId, input) => {
        record('create', { clientId, input });
        return { id: 'req-1' };
      },
      view: async (requestId, clientId) => ({ requestId, clientId }),
      run: async (runId, clientId) => ({ runId, clientId }),
      enqueueRun: async (clientId, requestId) => {
        record('enqueue', { clientId, requestId });
        return { enqueued: false };
      },
    },
    integrations: {
      list: async () => [{ type: 'SERP' }, { type: 'AMAZON' }],
      save: async (clientId, type, integrationRecord) => {
        record('saveIntegration', { clientId, type, record: integrationRecord });
        return { type };
      },
      setEnabled: async (_clientId, type, enabled) => ({ type, enabled }),
      remove: async (clientId, type) => record('removeIntegration', { clientId, type }),
    },
    sources: {
      list: async () => [{ id: 'src-1' }],
      create: async (clientId, body) => {
        record('createSource', { clientId, body });
        return { id: 'src-new' };
      },
      update: async (sourceId, clientId, body) => {
        record('updateSource', { sourceId, clientId, body });
        return { id: sourceId };
      },
      archive: async (sourceId, clientId) => record('archiveSource', { sourceId, clientId }),
      typeOf: async () => 'VTEX',
    },
    credentials: {
      requireSource: async () => ({ type: 'VTEX', config: { baseUrl: 'https://loja.example' } }),
      save: async (sourceId, _clientId, credentialRecord) => {
        record('saveCredentials', { sourceId, record: credentialRecord });
        return { id: sourceId };
      },
      remove: async (sourceId) => ({ id: sourceId }),
    },
    manual: {
      requireSource: async () => ({ id: 'src-manual', name: 'Atacadão da Vila' }),
      listPrices: async (_clientId, _sourceId, query) => ({ data: [], pagination: query }),
      store: async (input) => {
        record('storeManual', input);
        return { imported: input.entries.length, batchId: 'b1', replaced: input.replace };
      },
    },
  };
}

function api(overrides: Partial<ResearchApiConfig> = {}): {
  routes: readonly ResearchRoute[];
  store: ReturnType<typeof fakeStore>;
} {
  const store = fakeStore();
  const { routes } = createApiProductResearch({
    store,
    diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
    vocabulary: PT_BR_MARKET_VOCABULARY,
    checks: {
      integrationCredentials: async () => null,
      sourceConfig: async () => null,
      publicUrlViolation: async () => null,
    },
    credentials: { encode: () => 'enc', hint: () => '****1234' },
    messages: PT_BR_RESEARCH_MESSAGES,
    connectors: {
      isMounted: (type) => type === 'SERP',
      types: () => ['VTEX', 'MANUAL'],
      credentialFieldsFor: (type) => (type === 'VTEX' ? ['appKey', 'appToken'] : undefined),
    },
    now: () => new Date('2026-08-21T12:00:00Z'),
    ...overrides,
  });
  return { routes, store };
}

function routeOf(routes: readonly ResearchRoute[], key: string): ResearchRoute {
  const found = routes.find((route) => `${route.method} ${route.path}` === key);
  if (!found) throw new Error(`no route ${key}`);
  return found;
}

const actor = { clientId: 't1', userId: 'u1' };

describe('createApiProductResearch', () => {
  it('refuses construction with any host decision missing', () => {
    expect(() => createApiProductResearch({} as never)).toThrow(/needs store/);
  });

  it('accepts a start as 202 with the request persisted even when the queue is down', async () => {
    const { routes, store } = api();
    const answer = await routeOf(routes, 'POST /research').handle({
      actor,
      params: {},
      query: {},
      body: { query: { term: 'arroz 5kg', quantity: 3 }, catalogRef: { type: 'product', id: 'p1' } },
    });
    // Durable row first, then the enqueue that never throws: enqueued false
    // still answers 202 — the reconciliation sweep re-enqueues.
    expect(answer).toEqual({ status: 202, body: { data: { requestId: 'req-1', enqueued: false } } });
    expect(store.calls['create']?.[0]).toMatchObject({
      clientId: 't1',
      input: { term: 'arroz 5kg', quantity: 3, catalogRefType: 'product', requestedBy: 'u1' },
    });
    expect(store.calls['enqueue']).toEqual([{ clientId: 't1', requestId: 'req-1' }]);
  });

  it('marks the integrations roster with the host-mounted flag', async () => {
    const { routes } = api();
    const answer = await routeOf(routes, 'GET /research/integrations').handle({
      actor,
      params: {},
      query: {},
    });
    expect(answer.body).toEqual({
      data: [
        { type: 'SERP', mounted: true },
        { type: 'AMAZON', mounted: false },
      ],
    });
  });

  it('refuses a provider-rejected integration key with the host words, persisting nothing', async () => {
    const { routes, store } = api({
      checks: {
        integrationCredentials: async () => ({ ok: false, error: 'HTTP 401' }),
        sourceConfig: async () => null,
        publicUrlViolation: async () => null,
      },
    });
    const answer = await routeOf(routes, 'PUT /research/integrations/:type').handle({
      actor,
      params: { type: 'SERP' },
      query: {},
      body: { credentials: { apiKey: 'k' }, enabled: true },
    });
    expect(answer).toEqual({
      status: 422,
      body: { error: 'Credencial recusada pelo provedor: HTTP 401' },
    });
    expect(store.calls['saveIntegration']).toBeUndefined();
  });

  it('stores an unprobed integration key UNVERIFIED, a probed pass VERIFIED', async () => {
    const { routes, store } = api();
    await routeOf(routes, 'PUT /research/integrations/:type').handle({
      actor,
      params: { type: 'AMAZON' },
      query: {},
      body: { credentials: { apiKey: 'k' }, enabled: true },
    });
    expect(store.calls['saveIntegration']?.[0]).toMatchObject({
      record: { credentialStatus: 'UNVERIFIED', credentialsEncrypted: 'enc', credentialHint: '****1234' },
    });
    const probed = api({
      checks: {
        integrationCredentials: async () => ({ ok: true }),
        sourceConfig: async () => null,
        publicUrlViolation: async () => null,
      },
    });
    await routeOf(probed.routes, 'PUT /research/integrations/:type').handle({
      actor,
      params: { type: 'SERP' },
      query: {},
      body: { credentials: { apiKey: 'k' }, enabled: false },
    });
    expect(probed.store.calls['saveIntegration']?.[0]).toMatchObject({
      record: { credentialStatus: 'VERIFIED', enabled: false },
    });
  });

  it('vetoes a non-public source URL before the probe, and the probe before the write', async () => {
    const sourceConfig = vi.fn(async () => ({ ok: false as const, error: 'Loja não respondeu como VTEX.' }));
    const { routes, store } = api({
      checks: {
        integrationCredentials: async () => null,
        sourceConfig,
        publicUrlViolation: async (url) => (url.includes('interna') ? 'endereço privado' : null),
      },
    });
    const create = routeOf(routes, 'POST /research/sources');
    const vetoed = await create.handle({
      actor,
      params: {},
      query: {},
      body: { type: 'VTEX', config: { baseUrl: 'https://interna.local' } },
    });
    expect(vetoed).toEqual({
      status: 400,
      body: { error: 'URL da fonte rejeitada: endereço privado' },
    });
    expect(sourceConfig).not.toHaveBeenCalled();
    const refused = await create.handle({
      actor,
      params: {},
      query: {},
      body: { type: 'VTEX', config: { baseUrl: 'https://loja.example' } },
    });
    expect(refused).toEqual({ status: 422, body: { error: 'Loja não respondeu como VTEX.' } });
    expect(store.calls['createSource']).toBeUndefined();
  });

  it('skips the probe on a rename — no config, no connector setting touched', async () => {
    const sourceConfig = vi.fn(async () => null);
    const { routes, store } = api({
      checks: {
        integrationCredentials: async () => null,
        sourceConfig,
        publicUrlViolation: async () => null,
      },
    });
    await routeOf(routes, 'PATCH /research/sources/:sourceId').handle({
      actor,
      params: { sourceId: 'src-1' },
      query: {},
      body: { name: 'Atacadão 2' },
    });
    expect(sourceConfig).not.toHaveBeenCalled();
    expect(store.calls['updateSource']).toHaveLength(1);
  });

  it('refuses a credential save whose field names are not exactly the connector\'s', async () => {
    const { routes } = api();
    const put = routeOf(routes, 'PUT /research/sources/:sourceId/credentials');
    const incomplete = await put.handle({
      actor,
      params: { sourceId: 'src-1' },
      query: {},
      body: { credentials: { appKey: 'k' } },
    });
    expect(incomplete).toEqual({
      status: 422,
      body: { error: 'Informe todos os campos da chave: appKey, appToken.' },
    });
  });

  it('probes the stored config plus the submitted key, and stores UNVERIFIED on a pass', async () => {
    const sourceConfig = vi.fn(async () => ({ ok: true as const }));
    const { routes, store } = api({
      checks: {
        integrationCredentials: async () => null,
        sourceConfig,
        publicUrlViolation: async () => null,
      },
    });
    await routeOf(routes, 'PUT /research/sources/:sourceId/credentials').handle({
      actor,
      params: { sourceId: 'src-1' },
      query: {},
      body: { credentials: { appKey: 'k', appToken: 't' } },
    });
    expect(sourceConfig).toHaveBeenCalledWith('VTEX', {
      baseUrl: 'https://loja.example',
      credentials: { appKey: 'k', appToken: 't' },
    });
    // The probe proves the store ANSWERS, never that it checked the key.
    expect(store.calls['saveCredentials']?.[0]).toMatchObject({
      record: { credentialStatus: 'UNVERIFIED' },
    });
  });

  it('imports rows and CSV together, surfacing every unimportable line', async () => {
    const { routes, store } = api();
    const answer = await routeOf(routes, 'POST /research/sources/:sourceId/prices').handle({
      actor,
      params: { sourceId: 'src-manual' },
      query: {},
      body: {
        rows: [{ title: 'Arroz Tio João 5kg', price: 'R$ 24,90' }],
        csv: { content: 'produto;preco\nFeijão Carioca 1kg;R$ 8,90\n;faltando' },
        replace: true,
      },
    });
    const body = answer.body as { data: { imported: number; problems: unknown[] } };
    expect(answer.status).toBe(200);
    expect(body.data.imported).toBe(2);
    expect(body.data.problems.length).toBeGreaterThan(0);
    expect(store.calls['storeManual']?.[0]).toMatchObject({
      defaultSupplierName: 'Atacadão da Vila',
      replace: true,
    });
  });

  it('answers an unusable typed quote with the row reason, or the host fallback', async () => {
    const { routes } = api();
    const quote = routeOf(routes, 'POST /research/sources/:sourceId/quotes');
    const bad = await quote.handle({
      actor,
      params: { sourceId: 'src-manual' },
      query: {},
      body: { title: 'Óleo de soja', price: 'sem preço' },
    });
    expect(bad.status).toBe(400);
    expect((bad.body as { error: string }).error).not.toBe('');
    const good = await quote.handle({
      actor,
      params: { sourceId: 'src-manual' },
      query: {},
      body: { title: 'Óleo de soja 900ml', price: 'R$ 7,49' },
    });
    expect(good.status).toBe(200);
    expect((good.body as { data: { replaced: boolean } }).data.replaced).toBe(false);
  });

  it('pages the manual price roster with package defaults over string query values', async () => {
    const { routes } = api();
    const answer = await routeOf(routes, 'GET /research/sources/:sourceId/prices').handle({
      actor,
      params: { sourceId: 'src-manual' },
      query: { page: '2', pageSize: 'nope' },
    });
    expect(answer.body).toEqual({ data: [], pagination: { page: 2, pageSize: 50 } });
  });
});

describe('one mount, two languages', () => {
  /**
   * The property the resolver form of the copy port exists for: these sixteen
   * descriptors are built ONCE per process and the language changes per caller.
   *
   * The interesting case here is not that copy follows a reader — it is that
   * `vocabulary` must NOT. `diagnostics` and `messages` are sentences somebody
   * reads; `vocabulary` is a table matched against a FILE somebody uploaded, so
   * it follows the file. Resolving it from a request locale would stop an
   * English-reading admin's Portuguese supplier sheet parsing at all.
   */
  const bilingual = () =>
    api({
      // The shape `@12-apps/i18n`'s `localeCopy(PACK)` returns, spelled out so
      // this package keeps no dependency on it.
      messages: ({ locale }) =>
        locale === 'en-US' ? EN_US_RESEARCH_MESSAGES : PT_BR_RESEARCH_MESSAGES,
      diagnostics: ({ locale }) =>
        locale === 'en-US' ? EN_US_RESEARCH_DIAGNOSTICS : PT_BR_RESEARCH_DIAGNOSTICS,
      checks: {
        integrationCredentials: async () => null,
        sourceConfig: async () => null,
        publicUrlViolation: async () => 'private-network',
      },
    });

  const errorOf = (body: unknown): string =>
    (body as { error: { message: string } }).error?.message ?? String((body as { error: string }).error);

  const create = async (routes: readonly ResearchRoute[], locale: string | undefined) =>
    routeOf(routes, 'POST /research/sources').handle({
      actor,
      params: {},
      query: {},
      body: { name: 'x', type: 'VTEX', config: { baseUrl: 'http://10.0.0.1' } },
      ...(locale === undefined ? {} : { locale }),
    });

  it('answers the SSRF refusal in each caller’s language', async () => {
    const { routes } = bilingual();
    expect(errorOf((await create(routes, 'pt-BR')).body)).toContain(
      'URL da fonte rejeitada',
    );
    expect(errorOf((await create(routes, 'en-US')).body)).toContain('Source URL rejected');
  });

  it('hands an absent locale to the resolver rather than refusing', async () => {
    // A host with one audience populates nothing. The resolver decides what no
    // answer means, and here it means the default.
    const { routes } = bilingual();
    expect(errorOf((await create(routes, undefined)).body)).toContain(
      'URL da fonte rejeitada',
    );
  });

  it('leaves a plain-value host byte-identical', async () => {
    // The whole compatibility claim: words rather than a resolver behaves
    // exactly as before the field widened.
    const { routes } = api({
      checks: {
        integrationCredentials: async () => null,
        sourceConfig: async () => null,
        publicUrlViolation: async () => 'private-network',
      },
    });
    expect(errorOf((await create(routes, 'en-US')).body)).toContain(
      'URL da fonte rejeitada',
    );
  });
});
