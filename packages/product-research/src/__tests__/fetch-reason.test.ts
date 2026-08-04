import { describe, expect, it } from 'vitest';

import {
  CREDENTIALS_STRIPPED,
  describeFetchFailure,
  diagnosticUrl,
  fetchJsonOutcome,
} from '../connectors/fetch-reason';
import type { ConnectorContext, FetchOutcome } from '../connectors/types';
import { vtexFailureMessage } from '../connectors/vtex-errors';
import { silentLogger } from '../memory';

/**
 * Unit (FUT-495): the seam that replaced "every failure is one null". Two
 * things are pinned here — that the helper reads the RICHEST transport the host
 * mounted (so a host that has not adopted `fetchJsonResult` degrades in
 * precision, not in behaviour), and that each failure kind gets a distinct,
 * actionable pt-BR clause.
 */

const CATALOG = 'https://www.atacadao.com.br/api/catalog_system/pub/products/search?ft=coca';

describe('fetchJsonOutcome transport tiers', () => {
  it('prefers fetchJsonResult and passes the reason through verbatim', async () => {
    const answer: FetchOutcome = { ok: false, failure: { kind: 'http', status: 429 } };
    const ctx: ConnectorContext = {
      logger: silentLogger,
      fetchJson: () => Promise.resolve({ never: 'used' }),
      fetchJsonStatus: () => Promise.resolve({ status: 200, payload: { alsoNever: true } }),
      fetchJsonResult: () => Promise.resolve(answer),
    };

    await expect(fetchJsonOutcome(ctx, CATALOG)).resolves.toEqual(answer);
  });

  it('classifies a status-carrying host: non-2xx → http, 2xx non-JSON → body', async () => {
    const statusCtx = (status: number, payload: unknown | null): ConnectorContext => ({
      logger: silentLogger,
      fetchJson: () => Promise.resolve(null),
      fetchJsonStatus: () => Promise.resolve({ status, payload }),
    });

    await expect(fetchJsonOutcome(statusCtx(403, null), CATALOG)).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 403 },
    });
    await expect(fetchJsonOutcome(statusCtx(200, null), CATALOG)).resolves.toEqual({
      ok: false,
      failure: { kind: 'body', status: 200 },
    });
    await expect(fetchJsonOutcome(statusCtx(200, [{ productName: 'Coca' }]), CATALOG)).resolves.toEqual(
      { ok: true, payload: [{ productName: 'Coca' }] },
    );
  });

  it('reads a status-carrying host that answered nothing as a transport failure', async () => {
    const ctx: ConnectorContext = {
      logger: silentLogger,
      fetchJson: () => Promise.resolve(null),
      fetchJsonStatus: () => Promise.resolve(null),
    };

    await expect(fetchJsonOutcome(ctx, CATALOG)).resolves.toEqual({
      ok: false,
      failure: { kind: 'transport' },
    });
  });

  it('falls back to fetchJson: a payload is a success, null an undetermined failure', async () => {
    const plain = (payload: unknown | null): ConnectorContext => ({
      logger: silentLogger,
      fetchJson: () => Promise.resolve(payload),
    });

    await expect(fetchJsonOutcome(plain([]), CATALOG)).resolves.toEqual({ ok: true, payload: [] });
    await expect(fetchJsonOutcome(plain(null), CATALOG)).resolves.toEqual({
      ok: false,
      failure: { kind: 'transport' },
    });
  });

  it('forwards per-call headers to whichever transport answers', async () => {
    const seen: { headers?: Record<string, string> }[] = [];
    const ctx: ConnectorContext = {
      logger: silentLogger,
      fetchJson: () => Promise.resolve(null),
      fetchJsonResult: (_url, init) => {
        seen.push({ headers: init?.headers });
        return Promise.resolve({ ok: true, payload: [] });
      },
    };

    await fetchJsonOutcome(ctx, CATALOG, { headers: { 'X-Store-Token': 'abc' } });

    expect(seen).toEqual([{ headers: { 'X-Store-Token': 'abc' } }]);
  });
});

describe('describeFetchFailure', () => {
  it('says what an operator can act on for each HTTP arm', () => {
    expect(describeFetchFailure({ kind: 'http', status: 403 })).toContain('recusou nosso acesso');
    expect(describeFetchFailure({ kind: 'http', status: 403 })).toContain('bloqueio de bot');
    expect(describeFetchFailure({ kind: 'http', status: 401 })).toContain('HTTP 401');
    expect(describeFetchFailure({ kind: 'http', status: 404 })).toContain('não existe na loja');
    expect(describeFetchFailure({ kind: 'http', status: 429 })).toContain('limitou nossa taxa');
    expect(describeFetchFailure({ kind: 'http', status: 500 })).toContain('erro interno');
    // An unusual 4xx still reads as a refusal WITH its number, never as silence.
    expect(describeFetchFailure({ kind: 'http', status: 418 })).toContain('HTTP 418');
  });

  it('keeps timeout, non-JSON body and transport distinct', () => {
    expect(describeFetchFailure({ kind: 'timeout' })).toContain('tempo limite');
    expect(describeFetchFailure({ kind: 'body', status: 200 })).toContain('não em JSON');
    expect(describeFetchFailure({ kind: 'transport' })).toContain('rede, DNS ou TLS');
    expect(describeFetchFailure({ kind: 'transport', code: 'CERT_HAS_EXPIRED' })).toContain(
      'CERT_HAS_EXPIRED',
    );
  });

  it('blames OUR ceiling for a deadline, never the store and never the network', () => {
    // `describeFetchFailure` is a non-exhaustive if-chain ending in
    // `transportReason`, so a MISSING `deadline` arm compiles and renders
    // "falha de conexão com a loja (rede, DNS ou TLS)" for a request we chose
    // not to send — sending an operator to check a perfectly healthy store.
    const reason = describeFetchFailure({ kind: 'deadline' });

    expect(reason).toContain('tempo total permitido');
    expect(reason).not.toContain('rede, DNS ou TLS');
    // Distinct from the store-was-slow arm: the two send an operator to
    // different places, so they must never collapse into one sentence.
    expect(reason).not.toBe(describeFetchFailure({ kind: 'timeout' }));
    // This text is stored and rendered: no url, no endpoint, no query string.
    expect(reason).not.toContain('://');
    expect(reason).not.toContain('?');
  });

  it('still redacts the address when a cut VTEX tier composes its sentence', () => {
    const message = vtexFailureMessage('catalog', { kind: 'deadline' }, CATALOG);

    expect(message).toContain('tempo total permitido');
    expect(message).toContain(
      'Endereço: https://www.atacadao.com.br/api/catalog_system/pub/products/search',
    );
    expect(message).not.toContain('?ft=');
  });

  it('tells a name that does not resolve from a store that refused us', () => {
    // A typo'd domain is the commonest misconfiguration there is, and the fix is
    // the operator's own URL field — so it must not read as a policy block or as
    // a generic `(rede, DNS ou TLS: ENOTFOUND)`.
    for (const code of ['DNS_UNRESOLVED', 'ENOTFOUND']) {
      const reason = describeFetchFailure({ kind: 'transport', code });
      expect(reason).toContain('domínio da loja não foi encontrado');
      expect(reason).toContain('confira o endereço');
      expect(reason).not.toContain(code);
    }
    expect(describeFetchFailure({ kind: 'transport', code: 'EAI_AGAIN' })).toContain('DNS');
    // A genuine policy refusal keeps saying so.
    expect(describeFetchFailure({ kind: 'transport', code: 'BLOCKED_DESTINATION' })).toContain(
      'BLOCKED_DESTINATION',
    );
  });

  it('tells a request we DECLINED to send from one the network refused', () => {
    // FUT-520. `describeFetchFailure` is an if-chain ending in an unguarded
    // fallback, so a missing arm here compiles and simply renders "falha de
    // conexão com a loja (rede, DNS ou TLS: CREDENTIALS_STRIPPED)" — a network
    // story for a walk the host stopped on purpose, and a fix (the address
    // field) the operator would never find. The literal is asserted verbatim
    // because the host names the same string independently.
    const reason = describeFetchFailure({ kind: 'transport', code: CREDENTIALS_STRIPPED });

    expect(CREDENTIALS_STRIPPED).toBe('CREDENTIALS_STRIPPED');
    expect(reason).toContain('redireciona para outro endereço');
    expect(reason).toContain('chave de aplicação');
    expect(reason).toContain('www');
    expect(reason).not.toContain('rede, DNS ou TLS');
    expect(reason).not.toContain(CREDENTIALS_STRIPPED);
  });
});

describe('diagnosticUrl', () => {
  it('keeps origin and path, drops the query and the fragment', () => {
    expect(diagnosticUrl(CATALOG)).toBe(
      'https://www.atacadao.com.br/api/catalog_system/pub/products/search',
    );
    expect(diagnosticUrl('https://loja.com.br/api?key=secret#frag')).toBe(
      'https://loja.com.br/api',
    );
  });

  it('never throws on garbage', () => {
    expect(diagnosticUrl('not a url')).toBe('(endereço inválido)');
  });
});
