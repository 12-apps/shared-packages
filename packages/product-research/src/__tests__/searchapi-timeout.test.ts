import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';

import { createAmazonConnector } from '../connectors/amazon';
import { SEARCHAPI_TIMEOUT_MS } from '../connectors/searchapi';
import { createSerpConnector } from '../connectors/serp';
import type {
  ConnectorContext,
  FetchFailure,
  FetchInit,
  FetchOutcome,
  PriceSourceConnector,
} from '../connectors/types';
import { vtexConnector } from '../connectors/vtex';
import { silentLogger } from '../memory';
import type { ResearchQuery, SourceRecord, SourceType } from '../types';
import { PT_BR_MARKET_VOCABULARY } from '../normalize/pt-BR';

/**
 * Unit (FUT-502): the PER-CONNECTOR fetch budget, and the reasons a paid
 * SearchApi call can now fail with.
 *
 * Production evidence this pins, tenant `future-drink`, query "coca cola
 * 220ml", two runs an hour apart on ONE key: `google_shopping` OK in 7967ms,
 * then aborted at 10346ms and recorded as "unreachable or rejected" with
 * `costUnits 1` — while `amazon_search` answered in 3106ms in that same run.
 * Two things were wrong: the 10s global ceiling sat inside the engine's normal
 * latency, and a timeout was indistinguishable from a rejected key.
 *
 * The budget is asserted as the value REACHING THE TRANSPORT, not as a constant
 * that exists: a connector declaring a number nobody forwards is exactly the
 * bug this file is here to catch.
 */

const QUERY: ResearchQuery = { term: 'coca cola 220ml', quantity: 12, region: '01310-100' };

const source = (type: SourceType, config: Record<string, unknown> = {}): SourceRecord => ({
  id: `${type.toLowerCase()}-1`,
  clientId: 'future-drink',
  type,
  name: type === 'SERP' ? 'Busca web' : type,
  config,
  enabled: true,
  status: 'ACTIVE',
});

interface Seen {
  url: string;
  timeoutMs?: number;
}

/**
 * A host that mounts the richest transport tier (`fetchJsonResult`) and records
 * the init every call arrives with.
 */
const resultCtx = (
  answer: (url: string) => FetchOutcome,
  seen: Seen[] = [],
): ConnectorContext => ({
  logger: silentLogger,
  diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  fetchJson: () => Promise.resolve(null),
  fetchJsonResult: (url: string, init?: FetchInit) => {
    seen.push({ url, timeoutMs: init?.timeoutMs });
    return Promise.resolve(answer(url));
  },
});

const failing = (failure: FetchFailure) => (): FetchOutcome => ({ ok: false, failure });

const serp = () => createSerpConnector({ getApiKey: () => 'sk-host-fallback', vocabulary: PT_BR_MARKET_VOCABULARY });
const amazon = () => createAmazonConnector({ getApiKey: () => 'sk-host-fallback', vocabulary: PT_BR_MARKET_VOCABULARY });

describe('the SearchApi budget reaches the transport', () => {
  it('asks for its own budget on a SERP search, not the host default', async () => {
    const seen: Seen[] = [];
    await serp().search(QUERY, source('SERP'), resultCtx(failing({ kind: 'timeout' }), seen));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.timeoutMs).toBe(SEARCHAPI_TIMEOUT_MS);
  });

  it('asks for the same budget on an Amazon search — one vendor, one ceiling', async () => {
    const seen: Seen[] = [];
    await amazon().search(QUERY, source('AMAZON'), resultCtx(failing({ kind: 'timeout' }), seen));

    expect(seen).toHaveLength(1);
    expect(seen[0]?.timeoutMs).toBe(SEARCHAPI_TIMEOUT_MS);
  });

  it('sits well above the measured latency of the engine that failed', () => {
    // 7967ms was a SUCCESS and 10346ms was our own abort (so the request was
    // still alive at 10.3s — its real duration is unknown). The budget must
    // clear both with room, not merely exceed the successful sample.
    expect(SEARCHAPI_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * 7_967);
    expect(SEARCHAPI_TIMEOUT_MS).toBeGreaterThan(10_346);
  });
});

describe('the default budget is untouched for connectors that ask for nothing', () => {
  it('leaves a VTEX catalog search with no timeoutMs at all', async () => {
    const seen: Seen[] = [];
    await vtexConnector.search(
      QUERY,
      source('VTEX', { baseUrl: 'https://www.atacadao.com.br' }),
      resultCtx(failing({ kind: 'http', status: 403 }), seen),
    );

    // A slow paid API is no reason to let a dead store hang: every VTEX tier
    // states no budget, so the host's own default stays in force.
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) expect(call.timeoutMs).toBeUndefined();
  });
});

describe('a SearchApi timeout reads as a timeout, a 401 as a rejected key', () => {
  const errorOf = async (failure: FetchFailure): Promise<string> => {
    const result = await serp().search(QUERY, source('SERP'), resultCtx(failing(failure)));
    return result.ok ? '' : result.error;
  };

  it('names the timeout AND its budget, and blames no credential', async () => {
    const error = await errorOf({ kind: 'timeout' });

    expect(error).toContain('tempo limite');
    expect(error).toContain('20s');
    expect(error).toContain('google_shopping');
    // The production string this ticket exists to kill.
    expect(error).not.toContain('unreachable or rejected');
    expect(error).not.toContain('chave recusada');
  });

  it('says the key was rejected on a 401, and never calls it a timeout', async () => {
    const error = await errorOf({ kind: 'http', status: 401 });

    expect(error).toContain('chave recusada');
    expect(error).toContain('HTTP 401');
    expect(error).not.toContain('tempo limite');
  });

  it('keeps every other arm distinct from those two', async () => {
    expect(await errorOf({ kind: 'http', status: 429 })).toContain('limite de consultas');
    expect(await errorOf({ kind: 'http', status: 503 })).toContain('erro interno');
    expect(await errorOf({ kind: 'body', status: 200 })).toContain('não era JSON');
    expect(await errorOf({ kind: 'transport', code: 'ENOTFOUND' })).toContain('ENOTFOUND');
  });

  it('says why a paid credit may have been spent on a timeout', async () => {
    // The stat still carries costUnits 1 (the vendor bills a search it finished
    // after we hung up), so the message has to explain the charge.
    expect(await errorOf({ kind: 'timeout' })).toContain('crédito pago');
  });

  it('tells a self-imposed deadline from a slow vendor, and says no credit was spent', async () => {
    // `failureReason` is a non-exhaustive if-chain whose tail is the provider
    // transport clause, so a MISSING `deadline` arm compiles and reports a cut
    // paid search as "falha de conexão com o provedor (rede, DNS ou TLS)" —
    // the vendor's network blamed for a request we never sent (FUT-516).
    const error = await errorOf({ kind: 'deadline' });

    expect(error).toContain('tempo total permitido');
    expect(error).not.toContain('rede, DNS ou TLS');
    // The credit note is the MIRROR of the timeout arm's: nothing left this
    // process, so unlike a timeout there is nothing the vendor could bill.
    expect(error).toContain('nenhum crédito pago foi consumido');
    expect(error).not.toBe(await errorOf({ kind: 'timeout' }));
  });

  it('never leaks the key, a query string or an Authorization header', async () => {
    const failures: FetchFailure[] = [
      { kind: 'timeout' },
      { kind: 'deadline' },
      { kind: 'http', status: 401 },
      { kind: 'body', status: 200 },
      { kind: 'transport', code: 'ENOTFOUND' },
    ];

    for (const failure of failures) {
      const error = await errorOf(failure);
      expect(error).not.toContain('sk-host-fallback');
      expect(error).not.toContain('Bearer');
      expect(error).not.toContain('?');
      expect(error).not.toContain('searchapi.io');
    }
  });
});

/**
 * The arms above all come from a `FetchFailure`. FUT-502 converted those and
 * left the three that never produce one still composing English inline in
 * `searchapi.ts` — including the missing-key sentence that named the host env
 * var. This is the net that catches the next arm to grow back in English.
 */
describe('every SearchApi arm speaks pt-BR (FUT-517)', () => {
  const answering = (payload: unknown): ConnectorContext =>
    resultCtx(() => ({ ok: true, payload }));

  const errorOf = async (connector: PriceSourceConnector, payload: unknown): Promise<string> => {
    const result = await connector.search(QUERY, source('SERP'), answering(payload));
    return result.ok ? '' : result.error;
  };

  const keyless = () => createSerpConnector({ getApiKey: () => undefined, vocabulary: PT_BR_MARKET_VOCABULARY });

  /** The payload each non-fetch arm reacts to; the key arm never gets that far. */
  const armPayloads: [PriceSourceConnector, unknown][] = [
    [keyless(), {}],
    [serp(), []],
    [serp(), { error: 'Searches quota exceeded for your plan' }],
  ];

  it('gives each of the three non-fetch arms its own pt-BR sentence', async () => {
    expect(await errorOf(keyless(), {})).toContain('chave de API não configurada');
    expect(await errorOf(serp(), [])).toContain('formato inesperado');
    expect(await errorOf(serp(), { error: 'Searches quota exceeded for your plan' })).toContain(
      'resposta do provedor',
    );
  });

  it('leaves no English arm and no env-var hint behind', async () => {
    for (const [connector, payload] of armPayloads) {
      const error = await errorOf(connector, payload);
      // A platform-operator fact a tenant admin cannot act on.
      expect(error).not.toContain('SEARCHAPI_API_KEY');
      // The three English strings this ticket replaced.
      expect(error).not.toContain('not configured');
      expect(error).not.toContain('unexpected payload');
      expect(error).not.toContain(' error: ');
      // Same punctuation rule the leak sweep above pins: a `?` in one of these
      // sentences would mean a URL query string reached it.
      expect(error).not.toContain('?');
    }
  });
});
