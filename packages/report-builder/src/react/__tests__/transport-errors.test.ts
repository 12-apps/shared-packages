import { afterEach, describe, expect, it, vi } from 'vitest';

import { EN_US_REPORT_SCREENS_COPY } from '../en-US';
import { PT_BR_REPORT_SCREENS_COPY } from '../pt-BR';
import { httpTransport } from '../transport';

/**
 * FUT-4070: a failed call reads in the HOST's words.
 *
 * The default transport used to word its own failures, in English: a refusal
 * with no sentence in its body became `HTTP 503`, a read became
 * `HTTP 503 for /api/...`, and a dropped connection surfaced the thrown error's
 * message — for `fetch`, the browser's own "Failed to fetch". A pt-BR screen
 * painted all three. Each case is pinned here against the pt-BR pack, and the
 * server's own sentence is pinned to keep winning over them.
 */

/** A fresh pt-BR transport per call, so no test shares state with another. */
const ptBr = () => httpTransport({ errors: PT_BR_REPORT_SCREENS_COPY.errors });

function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

function reject(error: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw error;
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a write (send) that fails', () => {
  it('names the status in the host words when the body carries no sentence', async () => {
    answer(503, {});
    await expect(ptBr().send('/api/reports/run', 'POST', {})).resolves.toEqual({
      ok: false,
      error: 'Erro 503',
    });
  });

  it("keeps the server's own sentence and its field errors", async () => {
    answer(422, { error: 'Dê um nome ao relatório.', issues: { name: 'Obrigatório' } });
    await expect(ptBr().send('/api/reports', 'POST', {})).resolves.toEqual({
      ok: false,
      error: 'Dê um nome ao relatório.',
      fieldErrors: { name: 'Obrigatório' },
    });
  });

  it("says the connection failed, never the browser's TypeError message", async () => {
    reject(new TypeError('Failed to fetch'));
    await expect(ptBr().send('/api/reports', 'POST', {})).resolves.toEqual({
      ok: false,
      error: 'Falha de conexão',
    });
  });

  it("says the connection failed, never a thrown error's message", async () => {
    reject(new Error('socket hang up'));
    await expect(ptBr().send('/api/reports', 'DELETE')).resolves.toEqual({
      ok: false,
      error: 'Falha de conexão',
    });
  });

  it('says the connection failed when something other than an Error is thrown', async () => {
    reject('aborted');
    await expect(ptBr().send('/api/reports', 'DELETE')).resolves.toEqual({
      ok: false,
      error: 'Falha de conexão',
    });
  });
});

describe('a read (get / getRaw) that fails', () => {
  it('rejects with the status in the host words, without the path', async () => {
    answer(503, {});
    await expect(ptBr().get('/api/reports/saved')).rejects.toThrow(/^Erro 503$/);
    await expect(ptBr().getRaw('/api/roles')).rejects.toThrow(/^Erro 503$/);
  });

  it("rejects with the connection failure, never the browser's TypeError message", async () => {
    reject(new TypeError('Failed to fetch'));
    await expect(ptBr().get('/api/reports/saved')).rejects.toThrow(/^Falha de conexão$/);
  });

  it('still unwraps the envelope when the call succeeds', async () => {
    answer(200, { data: { id: 'r1' } });
    await expect(ptBr().get('/api/reports/saved/r1')).resolves.toEqual({ id: 'r1' });
  });
});

describe('the pack decides the words', () => {
  it('reads in English on the en-US pack', async () => {
    const enUs = httpTransport({ errors: EN_US_REPORT_SCREENS_COPY.errors });
    answer(503, {});
    await expect(enUs.send('/api/reports', 'POST', {})).resolves.toEqual({
      ok: false,
      error: 'HTTP 503',
    });
    reject(new TypeError('Failed to fetch'));
    await expect(enUs.send('/api/reports', 'POST', {})).resolves.toEqual({
      ok: false,
      error: 'network error',
    });
  });

  it('falls back to the en-US pack when the host names none', async () => {
    reject(new TypeError('Failed to fetch'));
    await expect(httpTransport().send('/api/reports', 'POST', {})).resolves.toEqual({
      ok: false,
      error: EN_US_REPORT_SCREENS_COPY.errors.network,
    });
  });
});
