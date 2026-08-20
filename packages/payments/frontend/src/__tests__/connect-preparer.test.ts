import { afterEach, describe, expect, it, vi } from 'vitest';

import { createConnectPreparer } from '../components/connect-preparer';

/**
 * The start of the connect round trip.
 *
 * The property under test throughout: an owner is sent to the provider's site
 * only when something usable came back. Every other answer stops HERE, with
 * the host's own sentence, rather than becoming a failure on the way back.
 */

const MINT_FAILED = 'copy:mint-failed';

function preparer(answer: { ok?: boolean; body?: unknown } = {}) {
  const calls: { url: string; method: string | undefined }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      return {
        ok: answer.ok ?? true,
        json: async () => {
          if (answer.body === 'not-json') throw new Error('unparseable');
          return answer.body ?? { state: 'STATE', redirectUri: 'https://provider.example/oauth' };
        },
      } as unknown as Response;
    }),
  );
  const prepare = createConnectPreparer({
    prepareUrl: (provider, environment) => `/api/loja/payments/${provider}/prepare?env=${environment}`,
    mintFailed: MINT_FAILED,
  });
  return { prepare, calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createConnectPreparer', () => {
  it('POSTs to the URL the host built for this provider and environment', async () => {
    const io = preparer();

    await io.prepare('pagbank', 'SANDBOX');

    expect(io.calls).toEqual([
      { url: '/api/loja/payments/pagbank/prepare?env=SANDBOX', method: 'POST' },
    ]);
  });

  it('hands back the state and where to send the owner', async () => {
    const io = preparer();

    await expect(io.prepare('pagbank', 'PRODUCTION')).resolves.toMatchObject({
      state: 'STATE',
      redirectUri: 'https://provider.example/oauth',
    });
  });

  it('echoes an environment the server named', async () => {
    const io = preparer({
      body: { state: 'STATE', redirectUri: 'https://p.example', environment: 'SANDBOX' },
    });

    await expect(io.prepare('pagbank', 'SANDBOX')).resolves.toMatchObject({
      environment: 'SANDBOX',
    });
  });

  it('drops an environment it does not recognise', async () => {
    const io = preparer({
      body: { state: 'STATE', redirectUri: 'https://p.example', environment: 'STAGING' },
    });

    // The server sealed the real one into the cookie, so it is the authority —
    // but a value from outside the two this package knows is not usable as one
    // of them, and passing it on would have the caller act on a third mode.
    await expect(io.prepare('pagbank', 'SANDBOX')).resolves.toMatchObject({
      environment: undefined,
    });
  });

  it('refuses when the route would not mint', async () => {
    const io = preparer({ ok: false });

    await expect(io.prepare('pagbank', 'SANDBOX')).rejects.toThrow(MINT_FAILED);
  });

  it('refuses a 200 that carries no state', async () => {
    const io = preparer({ body: { redirectUri: 'https://p.example' } });

    // The failure that makes this worth checking: cast and handed on, this
    // sends the owner away with `state=undefined` and comes back as
    // `state_mismatch` — "the connection expired", to someone whose connection
    // never started.
    await expect(io.prepare('pagbank', 'SANDBOX')).rejects.toThrow(MINT_FAILED);
  });

  it('refuses a 200 whose state is empty', async () => {
    const io = preparer({ body: { state: '', redirectUri: 'https://p.example' } });

    await expect(io.prepare('pagbank', 'SANDBOX')).rejects.toThrow(MINT_FAILED);
  });

  it('refuses a 200 that carries nowhere to send the owner', async () => {
    const io = preparer({ body: { state: 'STATE' } });

    await expect(io.prepare('pagbank', 'SANDBOX')).rejects.toThrow(MINT_FAILED);
  });

  it('refuses an answer that is not JSON at all', async () => {
    const io = preparer({ body: 'not-json' });

    await expect(io.prepare('pagbank', 'SANDBOX')).rejects.toThrow(MINT_FAILED);
  });
});
