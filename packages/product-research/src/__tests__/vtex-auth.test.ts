import { PT_BR_RESEARCH_DIAGNOSTICS } from '../pt-BR';
import { describe, expect, it } from 'vitest';

import { CREDENTIALS_KEY } from '../integrations';
import type { SourceRecord } from '../types';
import { vtexAuthInit, VTEX_CREDENTIAL_FIELDS, vtexCredentials } from '../connectors/vtex-auth';
import { vtexFailureMessage } from '../connectors/vtex-errors';

/**
 * Unit (FUT-520): the optional VTEX application key. Three properties are
 * pinned here because each one, broken, is invisible in production:
 *
 * 1. the pair is all-or-nothing — a one-header request can only 403, and that
 *    403 would then be blamed on the store's edge;
 * 2. the credential reaches the wire as HEADERS and as nothing else;
 * 3. no message about it ever carries a value.
 */

const APP_KEY = 'vtexappkey-lojademo-ABCDEF';
const APP_TOKEN = 'PZWKPYWXQAOPJDLBFMAAGXLWRTJDNRQFMBAAAOSGDKHVOOJKYA';

const source = (credentials?: Record<string, unknown>): Pick<SourceRecord, 'config'> => ({
  config: credentials === undefined ? {} : { [CREDENTIALS_KEY]: credentials },
});

const KEYED = source({ appKey: APP_KEY, appToken: APP_TOKEN });

describe('vtexCredentials', () => {
  it('reads the pair the host injected under config.credentials', () => {
    expect(vtexCredentials(KEYED)).toEqual({ appKey: APP_KEY, appToken: APP_TOKEN });
  });

  it('trims the stored values, so a pasted key with whitespace still works', () => {
    expect(vtexCredentials(source({ appKey: `  ${APP_KEY} `, appToken: `${APP_TOKEN}\n` }))).toEqual(
      { appKey: APP_KEY, appToken: APP_TOKEN },
    );
  });

  it('treats a HALF-configured pair as no credential at all', () => {
    // VTEX authenticates the two headers together. Sending one produces a 403
    // that `vtex-errors` would then report as the store's bot/IP block — a
    // misconfiguration disguised as an outage.
    expect(vtexCredentials(source({ appKey: APP_KEY }))).toBeUndefined();
    expect(vtexCredentials(source({ appToken: APP_TOKEN }))).toBeUndefined();
    expect(vtexCredentials(source({ appKey: APP_KEY, appToken: '   ' }))).toBeUndefined();
    expect(vtexCredentials(source({ appKey: '', appToken: APP_TOKEN }))).toBeUndefined();
    // Non-string values are dropped upstream by `credentialsOf`.
    expect(vtexCredentials(source({ appKey: APP_KEY, appToken: 42 }))).toBeUndefined();
    expect(vtexCredentials(source())).toBeUndefined();
  });

  it('names the two fields the write surface validates', () => {
    expect(VTEX_CREDENTIAL_FIELDS).toEqual(['appKey', 'appToken']);
  });
});

describe('vtexAuthInit', () => {
  it('produces exactly the two documented headers, and declares the dependency', () => {
    expect(vtexAuthInit(KEYED)).toEqual({
      headers: {
        'X-VTEX-API-AppKey': APP_KEY,
        'X-VTEX-API-AppToken': APP_TOKEN,
      },
      credentialsRequired: true,
    });
  });

  it('carries the credential in headers ONLY — never a url, never a query field', () => {
    const init = vtexAuthInit(KEYED);
    // Everything but `headers` is policy, so a value can only escape through a
    // header name we chose. Serializing the rest proves nothing else holds one.
    const { headers, ...rest } = init ?? {};
    expect(Object.keys(headers ?? {})).toEqual(['X-VTEX-API-AppKey', 'X-VTEX-API-AppToken']);
    expect(JSON.stringify(rest)).not.toContain(APP_KEY);
    expect(JSON.stringify(rest)).not.toContain(APP_TOKEN);
  });

  it('is undefined for an unkeyed source — the requests stay exactly as they were', () => {
    expect(vtexAuthInit(source())).toBeUndefined();
    expect(vtexAuthInit(source({ appKey: APP_KEY }))).toBeUndefined();
  });
});

/**
 * FUT-520: a 401/403 on a request that CARRIED a key has a second candidate
 * explanation. Reported with the unkeyed wording it sends the operator to the
 * store's edge for a key they can rotate themselves.
 */
describe('vtexFailureMessage — the keyed 401/403 arm', () => {
  const CATALOG = 'https://www.atacadao.com.br/api/catalog_system/pub/products/search?ft=coca';

  it('adds the possibly-invalid-key clause on a keyed refusal, without a value', () => {
    const message = vtexFailureMessage('catalog', { kind: 'http', status: 403 }, CATALOG, PT_BR_RESEARCH_DIAGNOSTICS, true);

    expect(message).toContain('bloqueio de bot ou de IP');
    expect(message).toContain('chave de aplicação da fonte');
    expect(message).toContain('Fontes de preços');
    expect(message).not.toContain(APP_KEY);
    expect(message).not.toContain(APP_TOKEN);
  });

  it('leaves an UNKEYED refusal byte-identical to what it said before', () => {
    const unkeyed = vtexFailureMessage('catalog', { kind: 'http', status: 403 }, CATALOG, PT_BR_RESEARCH_DIAGNOSTICS);

    expect(unkeyed).toBe(
      'Busca no catálogo VTEX falhou: a loja recusou nosso acesso ' +
        '(HTTP 403 — bloqueio de bot ou de IP). ' +
        'Endereço: https://www.atacadao.com.br/api/catalog_system/pub/products/search',
    );
    expect(unkeyed).not.toContain('chave de aplicação');
  });

  it('never adds the clause to a status the key cannot explain', () => {
    for (const failure of [
      { kind: 'http', status: 404 },
      { kind: 'http', status: 429 },
      { kind: 'timeout' },
      { kind: 'transport', code: 'ENOTFOUND' },
    ] as const) {
      expect(vtexFailureMessage('catalog', failure, CATALOG, PT_BR_RESEARCH_DIAGNOSTICS, true)).not.toContain(
        'chave de aplicação',
      );
    }
  });
});
