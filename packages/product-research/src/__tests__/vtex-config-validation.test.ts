import { describe, expect, it } from 'vitest';
import type { ConnectorContext, FetchOutcome } from '../connectors/types';
import { vtexConnector } from '../connectors/vtex';
import { validateVtexSourceConfig } from '../connectors/vtex-validate';
import { silentLogger } from '../memory';

/**
 * The VTEX save-time config probe (FUT-492): every verdict arm of
 * `validateSourceConfig`, from the ConnectorContext seam — no network here.
 * The point of each assertion is the OPERATOR's message: a healthy store
 * passes, a JSON API that is not a VTEX catalog is named as such, a silent
 * store says so and suggests the retry, and a bare apex host gets the `www`
 * nudge that would have saved the two dead Atacadão sources.
 *
 * FUT-498 adds the post-merge review's arms: a rate-limited store is not the
 * wrong KIND of store (and says so, with a retry hint), a JSON array whose
 * items are not VTEX products is refused while an empty VTEX answer still
 * passes, apex detection covers the suffixes this codebase meets, and a
 * `baseUrl` carrying credentials, a query string or a fragment can neither
 * corrupt the probe URL nor reach a message.
 */

interface Seen {
  urls: string[];
}

/** A legacy catalog answer's product, in the shape the connector parses. */
const VTEX_PRODUCT = {
  productId: '3001',
  productName: 'Coca-Cola Original Lata 350ml',
  items: [{ ean: '7894900011517', sellers: [{ commertialOffer: { Price: 4.29 } }] }],
};

const statusCtx = (
  respond: (url: string) => { status: number; payload: unknown | null } | null,
  seen: Seen = { urls: [] },
): ConnectorContext => ({
  logger: silentLogger,
  fetchJson: () => Promise.resolve(null),
  fetchJsonStatus: (url) => {
    seen.urls.push(url);
    return Promise.resolve(respond(url));
  },
});

const plainCtx = (respond: (url: string) => unknown | null, seen: Seen = { urls: [] }): ConnectorContext => ({
  logger: silentLogger,
  fetchJson: (url) => {
    seen.urls.push(url);
    return Promise.resolve(respond(url));
  },
});

/**
 * The RICHEST transport a host can mount (FUT-495): the probe must read through
 * it, so a timeout is a timeout and a TLS failure names its code — instead of
 * both collapsing into the one silent arm.
 */
const resultCtx = (outcome: FetchOutcome, seen: Seen = { urls: [] }): ConnectorContext => ({
  logger: silentLogger,
  fetchJson: () => Promise.resolve(null),
  fetchJsonResult: (url) => {
    seen.urls.push(url);
    return Promise.resolve(outcome);
  },
});

const GIGA = 'https://www.giga.com.vc';

/** The ranged legacy catalog search the probe is supposed to call, once. */
const PROBE_URL = /\/api\/catalog_system\/pub\/products\/search\?ft=a&_from=0&_to=0$/;

describe('validateVtexSourceConfig', () => {
  it('passes a healthy store on ONE cheap ranged catalog-search call', async () => {
    const seen: Seen = { urls: [] };
    const ctx = statusCtx(() => ({ status: 200, payload: [VTEX_PRODUCT] }), seen);

    expect(await validateVtexSourceConfig({ baseUrl: GIGA }, ctx)).toEqual({ ok: true });
    expect(seen.urls).toHaveLength(1);
    expect(seen.urls[0]).toMatch(PROBE_URL);
    expect(seen.urls[0]?.startsWith(GIGA)).toBe(true);
  });

  it('passes an EMPTY result and a 206 — the probe judges the API, not the hits', async () => {
    expect(await validateVtexSourceConfig({ baseUrl: GIGA }, statusCtx(() => ({ status: 206, payload: [] })))).toEqual(
      { ok: true },
    );
    // The intelligent-search envelope is the same proof.
    expect(
      await validateVtexSourceConfig(
        { baseUrl: GIGA },
        statusCtx(() => ({ status: 200, payload: { products: [] } })),
      ),
    ).toEqual({ ok: true });
  });

  it('ignores a trailing slash and extra config keys', async () => {
    const seen: Seen = { urls: [] };
    const check = await validateVtexSourceConfig(
      { baseUrl: `${GIGA}/`, salesChannel: '2', regionalize: false },
      statusCtx(() => ({ status: 200, payload: [] }), seen),
    );

    expect(check).toEqual({ ok: true });
    // The trailing slash is gone — one clean probe URL, not a doubled path.
    expect(seen.urls[0]).toMatch(PROBE_URL);
    expect(seen.urls[0]).not.toContain('.vc//');
  });

  it('refuses a store that answers JSON that is not a VTEX catalog', async () => {
    const check = await validateVtexSourceConfig(
      { baseUrl: 'https://www.loja.example' },
      statusCtx(() => ({ status: 200, payload: { message: 'hello from some API' } })),
    );

    expect(check).toMatchObject({ ok: false });
    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('não parece ser uma loja VTEX');
  });

  it('refuses a 404 on the catalog path as "not a VTEX store", quoting the status', async () => {
    const check = await validateVtexSourceConfig(
      { baseUrl: 'https://www.loja.example' },
      statusCtx(() => ({ status: 404, payload: null })),
    );

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('HTTP 404');
    expect(check.error).toContain('não parece ser uma loja VTEX');
  });

  it('refuses an unreachable store with a message that invites a retry', async () => {
    const check = await validateVtexSourceConfig({ baseUrl: 'https://www.loja.example' }, statusCtx(() => null));

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('não respondeu');
    expect(check.error).toContain('tente novamente');
  });

  it('treats a 5xx as momentary instability, not as the wrong kind of store', async () => {
    const check = await validateVtexSourceConfig(
      { baseUrl: 'https://www.loja.example' },
      statusCtx(() => ({ status: 503, payload: null })),
    );

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('HTTP 503');
    expect(check.error).toContain('instabilidade momentânea');
    expect(check.error).not.toContain('não parece ser uma loja VTEX');
  });

  it('suggests the www host when a BARE APEX fails — the two dead Atacadão sources', async () => {
    const check = await validateVtexSourceConfig({ baseUrl: 'https://atacadao.com.br/' }, statusCtx(() => null));

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('https://www.atacadao.com.br');
  });

  it('does not suggest www for a host that already carries a subdomain', async () => {
    const check = await validateVtexSourceConfig(
      { baseUrl: 'https://loja.vtexcommercestable.com.br' },
      statusCtx(() => null),
    );

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).not.toContain('www.');
  });

  it('refuses a missing or unparseable baseUrl before any network call', async () => {
    const seen: Seen = { urls: [] };
    const ctx = statusCtx(() => ({ status: 200, payload: [] }), seen);

    for (const config of [{}, { baseUrl: 'nao-e-uma-url' }, { baseUrl: 42 }]) {
      const check = await validateVtexSourceConfig(config, ctx);
      if (check.ok) throw new Error('expected a refusal');
      expect(check.error).toContain('URL da loja inválida');
    }
    expect(seen.urls).toEqual([]);
  });

  it('falls back to the status-less transport: a JSON answer proves it, null is the silent arm', async () => {
    const seen: Seen = { urls: [] };
    expect(await validateVtexSourceConfig({ baseUrl: GIGA }, plainCtx(() => [], seen))).toEqual({ ok: true });
    expect(seen.urls[0]).toMatch(PROBE_URL);

    const silent = await validateVtexSourceConfig({ baseUrl: GIGA }, plainCtx(() => null));
    if (silent.ok) throw new Error('expected a refusal');
    expect(silent.error).toContain('não respondeu');

    const wrong = await validateVtexSourceConfig({ baseUrl: GIGA }, plainCtx(() => ({ nope: true })));
    if (wrong.ok) throw new Error('expected a refusal');
    expect(wrong.error).toContain('não parece ser uma loja VTEX');
  });

  it('treats a RATE LIMIT as "not now", never as the wrong kind of store (FUT-498)', async () => {
    const check = await validateVtexSourceConfig(
      { baseUrl: 'https://www.loja.example' },
      statusCtx(() => ({ status: 429, payload: null })),
    );

    if (check.ok) throw new Error('expected a refusal');
    // The owner's URL is fine — saying otherwise sent them hunting for a typo.
    expect(check.error).not.toContain('não parece ser uma loja VTEX');
    expect(check.error).not.toContain('Confira a URL');
    // Same words the run screen uses for a 429, plus the retry that fixes it.
    expect(check.error).toContain('HTTP 429');
    expect(check.error).toContain('limitou nossa taxa');
    expect(check.error).toContain('Tente novamente em alguns minutos');
  });

  it('does the same for a 408 and for a 403 block, and keeps 404 a wrong address', async () => {
    const busy = await validateVtexSourceConfig(
      { baseUrl: 'https://www.loja.example' },
      statusCtx(() => ({ status: 408, payload: null })),
    );
    if (busy.ok) throw new Error('expected a refusal');
    expect(busy.error).toContain('Tente novamente em alguns minutos');
    expect(busy.error).not.toContain('não parece ser uma loja VTEX');

    const blocked = await validateVtexSourceConfig(
      { baseUrl: 'https://www.loja.example' },
      statusCtx(() => ({ status: 403, payload: null })),
    );
    if (blocked.ok) throw new Error('expected a refusal');
    expect(blocked.error).toContain('recusou nosso acesso');
    expect(blocked.error).not.toContain('não parece ser uma loja VTEX');

    // A 404 on the catalog path IS evidence the API is not at that address.
    const missing = await validateVtexSourceConfig(
      { baseUrl: 'https://www.loja.example' },
      statusCtx(() => ({ status: 404, payload: null })),
    );
    if (missing.ok) throw new Error('expected a refusal');
    expect(missing.error).toContain('não parece ser uma loja VTEX');
  });

  it('reads through the reason-carrying transport: a timeout says so (FUT-498)', async () => {
    const seen: Seen = { urls: [] };
    const check = await validateVtexSourceConfig(
      { baseUrl: GIGA },
      resultCtx({ ok: false, failure: { kind: 'timeout' } }, seen),
    );

    expect(seen.urls[0]).toMatch(PROBE_URL);
    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('tempo limite');
    expect(check.error).toContain('Tente novamente');

    // A name that does not resolve now says so in words instead of carrying
    // `ENOTFOUND` through: the fix is the operator's own URL field, and the
    // errno never pointed there. Codes that have no sentence of their own still
    // travel intact — asserted right below, so the FUT-495 vocabulary is still
    // pinned where it still applies.
    const dead = await validateVtexSourceConfig(
      { baseUrl: GIGA },
      resultCtx({ ok: false, failure: { kind: 'transport', code: 'ENOTFOUND' } }),
    );
    if (dead.ok) throw new Error('expected a refusal');
    expect(dead.error).toContain('não respondeu');
    expect(dead.error).toContain('domínio da loja não foi encontrado');

    const tls = await validateVtexSourceConfig(
      { baseUrl: GIGA },
      resultCtx({ ok: false, failure: { kind: 'transport', code: 'CERT_HAS_EXPIRED' } }),
    );
    if (tls.ok) throw new Error('expected a refusal');
    expect(tls.error).toContain('CERT_HAS_EXPIRED');

    // A 2xx that was not JSON is a storefront page, not a catalog API.
    const html = await validateVtexSourceConfig(
      { baseUrl: GIGA },
      resultCtx({ ok: false, failure: { kind: 'body', status: 200 } }),
    );
    if (html.ok) throw new Error('expected a refusal');
    expect(html.error).toContain('não parece ser uma loja VTEX');
  });

  it('refuses a JSON ARRAY whose items are not VTEX products (FUT-498)', async () => {
    // The failure this closes: any list-answering API used to pass, and the
    // owner got a source that saved cleanly and returned nothing forever.
    for (const payload of [
      [{ id: 1, title: 'algum item' }],
      ['coca-cola'],
      [42],
      { products: [{ id: 1, title: 'algum item' }] },
    ]) {
      const check = await validateVtexSourceConfig(
        { baseUrl: 'https://api.exemplo.example' },
        statusCtx(() => ({ status: 200, payload })),
      );
      if (check.ok) throw new Error(`expected a refusal for ${JSON.stringify(payload)}`);
      expect(check.error).toContain('não parece ser uma loja VTEX');
    }
  });

  it('still accepts an EMPTY VTEX answer — a real store may have no hits', async () => {
    // The deliberate line: shape-checked when there is something to check,
    // trusted when the store answered "no hits" in VTEX's own envelope.
    for (const payload of [[], { products: [] }]) {
      expect(
        await validateVtexSourceConfig({ baseUrl: GIGA }, statusCtx(() => ({ status: 200, payload }))),
      ).toEqual({ ok: true });
    }
    // …and a single VTEX-shaped SKU (sellers/commertialOffer) is proof too.
    expect(
      await validateVtexSourceConfig(
        { baseUrl: GIGA },
        statusCtx(() => ({
          status: 200,
          payload: { products: [{ sellers: [{ commertialOffer: { Price: 1 } }] }] },
        })),
      ),
    ).toEqual({ ok: true });
  });

  it('suggests www for every apex suffix this codebase meets (FUT-498)', async () => {
    const apexHosts = [
      'loja.com',
      'loja.com.br',
      'loja.ind.br',
      'loja.art.br',
      'loja.com.mx',
      'loja.com.ar',
      'loja.co.uk',
      'loja.co.jp',
      'loja.com.au',
    ];
    for (const host of apexHosts) {
      const check = await validateVtexSourceConfig({ baseUrl: `https://${host}` }, statusCtx(() => null));
      if (check.ok) throw new Error('expected a refusal');
      expect(check.error).toContain(`https://www.${host}`);
    }
    // A subdomain is still a subdomain — no nudge, whatever the suffix.
    for (const host of ['api.loja.br', 'www.loja.br', 'loja.vtexcommercestable.com.br']) {
      const check = await validateVtexSourceConfig({ baseUrl: `https://${host}` }, statusCtx(() => null));
      if (check.ok) throw new Error('expected a refusal');
      expect(check.error).not.toContain('tente https://www.');
    }
  });

  it('refuses a baseUrl carrying CREDENTIALS, without echoing them (FUT-498)', async () => {
    const seen: Seen = { urls: [] };
    const ctx = statusCtx(() => ({ status: 200, payload: [VTEX_PRODUCT] }), seen);

    const check = await validateVtexSourceConfig(
      { baseUrl: 'https://chave:segredo@www.loja.com.br' },
      ctx,
    );

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('usuário e senha');
    // Nothing of the credential reaches the operator's message…
    expect(check.error).not.toContain('chave');
    expect(check.error).not.toContain('segredo');
    // …and no request was made with it either.
    expect(seen.urls).toEqual([]);
  });

  it('builds the probe URL from the PARSED address: no query, no fragment', async () => {
    const seen: Seen = { urls: [] };
    await validateVtexSourceConfig(
      { baseUrl: 'https://www.giga.com.vc/?utm_source=x&api_key=segredo#topo' },
      statusCtx(() => ({ status: 200, payload: [VTEX_PRODUCT] }), seen),
    );

    // Rebuilt, not concatenated: the endpoint is clean and carries only the
    // probe's own parameters.
    expect(seen.urls[0]).toMatch(PROBE_URL);
    expect(seen.urls[0]).not.toContain('utm_source');
    expect(seen.urls[0]).not.toContain('segredo');
    expect(seen.urls[0]).not.toContain('#');
  });

  it('refuses a non-http scheme before any network call', async () => {
    const seen: Seen = { urls: [] };
    const check = await validateVtexSourceConfig(
      { baseUrl: 'ftp://arquivos.loja.com.br' },
      statusCtx(() => ({ status: 200, payload: [VTEX_PRODUCT] }), seen),
    );

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('URL da loja inválida');
    expect(seen.urls).toEqual([]);
  });

  it('is mounted as validateSourceConfig on the VTEX connector', async () => {
    expect(vtexConnector.validateSourceConfig).toBeDefined();
    expect(
      await vtexConnector.validateSourceConfig?.({ baseUrl: GIGA }, statusCtx(() => ({ status: 200, payload: [] }))),
    ).toEqual({ ok: true });
  });
});

/**
 * FUT-520 — the save-time key probe. Its whole design rests on one measured
 * fact: the probed endpoint is a `pub` one that answers 200 with or WITHOUT a
 * key. Two consequences the tests below pin, because both are easy to "fix"
 * into a lie later:
 *
 * - a pass proves reachability, NEVER that the key authenticates, so the
 *   credential is stored UNVERIFIED and this function must not claim otherwise;
 * - a 401/403 is only definitively about the key when the IDENTICAL unkeyed
 *   request succeeds. Atacadão's refusal survives dropping the key (it is made
 *   at their edge, by IP, before any credential is read), and reporting THAT as
 *   "chave recusada" is the misattribution the ticket exists to prevent.
 */
describe('validateVtexSourceConfig with an application key', () => {
  const APP_KEY = 'vtexappkey-giga-ABCDEF';
  const APP_TOKEN = 'PZWKPYWXQAOPJDLBFMAAGXLWRTJDNRQFMBAAAOSGDKHVOOJKYA';
  const AUTH_HEADERS = { 'X-VTEX-API-AppKey': APP_KEY, 'X-VTEX-API-AppToken': APP_TOKEN };

  const keyed = (baseUrl: string): Record<string, unknown> => ({
    baseUrl,
    credentials: { appKey: APP_KEY, appToken: APP_TOKEN },
  });

  interface Probe {
    url: string;
    headers?: Record<string, string>;
    credentialsRequired?: boolean;
  }

  /** Answers per attempt, so the keyed and unkeyed probes can differ. */
  const probeCtx = (
    respond: (probe: Probe) => FetchOutcome,
    probes: Probe[] = [],
  ): ConnectorContext => ({
    logger: silentLogger,
    fetchJson: () => Promise.resolve(null),
    fetchJsonResult: (url, init) => {
      const probe = {
        url,
        headers: init?.headers,
        credentialsRequired: init?.credentialsRequired,
      };
      probes.push(probe);
      return Promise.resolve(respond(probe));
    },
  });

  const keyedProbe = (probe: Probe): boolean => probe.headers !== undefined;

  it('runs the SAME probe with the headers, and passes without claiming VERIFIED', async () => {
    const probes: Probe[] = [];
    const check = await validateVtexSourceConfig(
      keyed(GIGA),
      probeCtx(() => ({ ok: true, payload: [VTEX_PRODUCT] }), probes),
    );

    // `{ ok: true }` and nothing else: there is no field here that could tell
    // the caller the key authenticates, and a `pub` 200 could not prove it.
    expect(check).toEqual({ ok: true });
    expect(probes).toHaveLength(1);
    expect(probes[0]?.url).toMatch(PROBE_URL);
    expect(probes[0]?.headers).toEqual(AUTH_HEADERS);
    expect(probes[0]?.credentialsRequired).toBe(true);
  });

  it('refuses the save when the key is what broke it: keyed 403, unkeyed 200', async () => {
    const probes: Probe[] = [];
    const check = await validateVtexSourceConfig(
      keyed(GIGA),
      probeCtx(
        (probe) =>
          keyedProbe(probe)
            ? { ok: false, failure: { kind: 'http', status: 403 } }
            : { ok: true, payload: [VTEX_PRODUCT] },
        probes,
      ),
    );

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('recusou a chave de aplicação');
    expect(check.error).toContain('License Manager');
    expect(check.error).not.toContain(APP_KEY);
    expect(check.error).not.toContain(APP_TOKEN);
    // The differential: same URL, twice, second one unkeyed.
    expect(probes).toHaveLength(2);
    expect(probes[1]?.url).toBe(probes[0]?.url);
    expect(probes[1]?.headers).toBeUndefined();
  });

  it('keeps the Atacadão verdict VERBATIM when the block survives dropping the key', async () => {
    const probes: Probe[] = [];
    const check = await validateVtexSourceConfig(
      keyed('https://www.atacadao.com.br'),
      probeCtx(() => ({ ok: false, failure: { kind: 'http', status: 403 } }), probes),
    );

    const unkeyedVerdict = await validateVtexSourceConfig(
      { baseUrl: 'https://www.atacadao.com.br' },
      probeCtx(() => ({ ok: false, failure: { kind: 'http', status: 403 } })),
    );

    if (check.ok || unkeyedVerdict.ok) throw new Error('expected a refusal');
    expect(check.error).toBe(unkeyedVerdict.error);
    expect(check.error).toContain('Não foi possível validar a loja agora');
    expect(check.error).toContain('Tente novamente');
    expect(check.error).not.toContain('chave');
    expect(probes).toHaveLength(2);
  });

  it('never fires the differential retry on a status the key cannot explain', async () => {
    for (const failure of [
      { kind: 'http', status: 404 },
      { kind: 'http', status: 429 },
      { kind: 'timeout' },
      { kind: 'transport', code: 'ENOTFOUND' },
    ] as const) {
      const probes: Probe[] = [];
      await validateVtexSourceConfig(keyed(GIGA), probeCtx(() => ({ ok: false, failure }), probes));
      expect(probes).toHaveLength(1);
    }
  });

  it('makes exactly ONE call for an unkeyed source — the retry is key-only', async () => {
    const probes: Probe[] = [];
    await validateVtexSourceConfig(
      { baseUrl: GIGA },
      probeCtx(() => ({ ok: false, failure: { kind: 'http', status: 403 } }), probes),
    );

    expect(probes).toHaveLength(1);
    expect(probes[0]?.headers).toBeUndefined();
  });

  it('points a stripped credential at the ADDRESS field, not at "not a VTEX store"', async () => {
    const probes: Probe[] = [];
    const check = await validateVtexSourceConfig(
      keyed('https://atacadao.com.br'),
      probeCtx(
        () => ({ ok: false, failure: { kind: 'transport', code: 'CREDENTIALS_STRIPPED' } }),
        probes,
      ),
    );

    if (check.ok) throw new Error('expected a refusal');
    expect(check.error).toContain('redireciona para outro endereço');
    expect(check.error).toContain('https://www.atacadao.com.br');
    expect(check.error).not.toContain('não parece ser uma loja VTEX');
    // Nothing to re-probe: the request never reached the store.
    expect(probes).toHaveLength(1);
  });

  it('ignores a half-configured pair — the probe runs unkeyed, exactly as before', async () => {
    const probes: Probe[] = [];
    const check = await validateVtexSourceConfig(
      { baseUrl: GIGA, credentials: { appKey: APP_KEY } },
      probeCtx(() => ({ ok: true, payload: [VTEX_PRODUCT] }), probes),
    );

    expect(check).toEqual({ ok: true });
    expect(probes[0]?.headers).toBeUndefined();
  });
});
