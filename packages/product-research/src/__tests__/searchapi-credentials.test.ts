import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';
import { createAmazonConnector } from '../connectors/amazon';
import { resolveSearchApiKey, SEARCHAPI_ACCOUNT_URL, validateSearchApiKey } from '../connectors/searchapi';
import { createSerpConnector } from '../connectors/serp';
import type { ConnectorContext } from '../connectors/types';
import { CREDENTIALS_KEY } from '../integrations';
import { silentLogger } from '../memory';
import { PT_BR_MARKET_VOCABULARY } from '../normalize/pt-BR';

/**
 * The SearchApi.io credential seams (FUT-434): `resolveSearchApiKey` puts the
 * TENANT's integration key ahead of the host env seam, and
 * `validateSearchApiKey` is the save-time probe both paid connectors mount —
 * one call to the vendor's account endpoint, definitive rejection vs
 * unverifiable kept apart. No network anywhere: the transport is stubbed at
 * the ConnectorContext seam.
 */

interface SeenRequest {
  url: string;
  headers?: Record<string, string>;
}

const ctxWithStatus = (
  respond: () => { status: number; payload: unknown | null } | null,
  seen: SeenRequest[] = [],
): ConnectorContext => ({
  logger: silentLogger,
  diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  fetchJson: () => Promise.resolve(null),
  fetchJsonStatus: (url, init) => {
    seen.push({ url, headers: init?.headers });
    return Promise.resolve(respond());
  },
});

const ctxWithoutStatus = (
  respond: () => unknown | null,
  seen: SeenRequest[] = [],
): ConnectorContext => ({
  logger: silentLogger,
  diagnostics: PT_BR_RESEARCH_DIAGNOSTICS,
  fetchJson: (url, init) => {
    seen.push({ url, headers: init?.headers });
    return Promise.resolve(respond());
  },
});

describe('resolveSearchApiKey', () => {
  it('puts the tenant credential ahead of the env seam, which stays the fallback', () => {
    const withTenant = { config: { [CREDENTIALS_KEY]: { apiKey: 'sk-tenant' } } };
    expect(resolveSearchApiKey(withTenant, () => 'sk-env')).toBe('sk-tenant');
    expect(resolveSearchApiKey({ config: {} }, () => 'sk-env')).toBe('sk-env');
    expect(resolveSearchApiKey({ config: {} }, () => undefined)).toBeUndefined();
  });

  it('treats a blank or non-string tenant credential as absent', () => {
    expect(
      resolveSearchApiKey({ config: { [CREDENTIALS_KEY]: { apiKey: '   ' } } }, () => 'sk-env'),
    ).toBe('sk-env');
    expect(
      resolveSearchApiKey({ config: { [CREDENTIALS_KEY]: { apiKey: 42 } } }, () => 'sk-env'),
    ).toBe('sk-env');
  });
});

describe('validateSearchApiKey', () => {
  it('proves the key against the account endpoint — Bearer header, no search spent', async () => {
    const seen: SeenRequest[] = [];
    const ctx = ctxWithStatus(() => ({ status: 200, payload: { plan: 'starter' } }), seen);

    const check = await validateSearchApiKey({ apiKey: 'sk-good' }, ctx);

    expect(check).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(SEARCHAPI_ACCOUNT_URL);
    expect(seen[0]?.headers).toMatchObject({ Authorization: 'Bearer sk-good' });
  });

  it('maps a 401/403 to a definitive rejection carrying the vendor reason', async () => {
    const unauthorized = ctxWithStatus(() => ({
      status: 401,
      payload: { error: 'Invalid API key.' },
    }));
    expect(await validateSearchApiKey({ apiKey: 'sk-bad' }, unauthorized)).toEqual({
      ok: false,
      error: 'SearchApi rejeitou a chave: Invalid API key.',
    });

    const forbidden = ctxWithStatus(() => ({ status: 403, payload: null }));
    expect(await validateSearchApiKey({ apiKey: 'sk-bad' }, forbidden)).toEqual({
      ok: false,
      error: 'SearchApi rejeitou a chave: HTTP 403',
    });
  });

  it('bounds an unbounded vendor reason, and falls back to the status on a blank one', async () => {
    // FUT-517: this reason is rendered in the integrations dialog, so the
    // vendor's body is single-lined and capped like every other echo — the
    // 44-char rejection above proves the bound is a no-op on a real one.
    const verbose = ctxWithStatus(() => ({
      status: 401,
      payload: { error: `Invalid API key.\n${'x '.repeat(3_000)}` },
    }));
    const check = await validateSearchApiKey({ apiKey: 'sk-bad' }, verbose);
    const error = check !== null && !check.ok ? check.error : '';

    expect(error.startsWith('SearchApi rejeitou a chave: Invalid API key.')).toBe(true);
    expect(error.length).toBeLessThan(300);
    expect(error.endsWith('…')).toBe(true);
    expect(error).not.toContain('\n');

    // A body that bounds down to nothing is no reason at all.
    const blank = ctxWithStatus(() => ({ status: 401, payload: { error: '  \n ' } }));
    expect(await validateSearchApiKey({ apiKey: 'sk-bad' }, blank)).toEqual({
      ok: false,
      error: 'SearchApi rejeitou a chave: HTTP 401',
    });
  });

  it('reports unverifiable (null) for an unreachable vendor or a 5xx — never a rejection', async () => {
    expect(await validateSearchApiKey({ apiKey: 'sk-x' }, ctxWithStatus(() => null))).toBeNull();
    expect(
      await validateSearchApiKey({ apiKey: 'sk-x' }, ctxWithStatus(() => ({ status: 503, payload: null }))),
    ).toBeNull();
  });

  it('rejects a record without an apiKey before any network call', async () => {
    const seen: SeenRequest[] = [];
    const check = await validateSearchApiKey({}, ctxWithStatus(() => ({ status: 200, payload: {} }), seen));
    expect(check).toMatchObject({ ok: false });
    expect(seen).toHaveLength(0);
  });

  it('on a status-less transport a 200 proves the key and any failure stays unverifiable', async () => {
    const seen: SeenRequest[] = [];
    expect(
      await validateSearchApiKey({ apiKey: 'sk-x' }, ctxWithoutStatus(() => ({ plan: 'starter' }), seen)),
    ).toEqual({ ok: true });
    expect(seen[0]?.url).toBe(SEARCHAPI_ACCOUNT_URL);

    // null could be a 401 OR an outage — never turn "unsure" into a refusal.
    expect(await validateSearchApiKey({ apiKey: 'sk-x' }, ctxWithoutStatus(() => null))).toBeNull();
  });

  it('is mounted as validateCredentials on both SearchApi connectors', async () => {
    const serp = createSerpConnector({ getApiKey: () => undefined, vocabulary: PT_BR_MARKET_VOCABULARY });
    const amazon = createAmazonConnector({ getApiKey: () => undefined, vocabulary: PT_BR_MARKET_VOCABULARY });
    const ctx = ctxWithStatus(() => ({ status: 401, payload: { error: 'Invalid API key.' } }));

    expect(await serp.validateCredentials?.({ apiKey: 'sk-bad' }, ctx)).toMatchObject({ ok: false });
    expect(await amazon.validateCredentials?.({ apiKey: 'sk-bad' }, ctx)).toMatchObject({ ok: false });
  });
});
