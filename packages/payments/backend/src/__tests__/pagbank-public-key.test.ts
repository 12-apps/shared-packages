import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPagbankCardPublicKey } from '../providers/pagbank-public-key';

/**
 * PagBank's on-demand card key (FUT-761, ported from the future-pay host —
 * the FUT-174 per-store rule). Best-effort by contract: a checkout that
 * falls back to the mock/pasted key must never be blocked by this read, so
 * every failure answers null and only a pre-send network error is retried.
 */

const CONFIG = { apiBase: 'https://api.pagseguro.test/', token: 'store-token' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('fetchPagbankCardPublicKey', () => {
  it('POSTs /public-keys with the MERCHANT token and answers the trimmed key', async () => {
    const spy = stubFetch(async () => Response.json({ public_key: '  PUB_KEY_1  ' }));

    await expect(fetchPagbankCardPublicKey(CONFIG)).resolves.toBe('PUB_KEY_1');

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.pagseguro.test/public-keys');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer store-token');
    expect(init.body).toBe('{"type":"card"}');
  });

  it('answers null without calling anything when there is no token', async () => {
    const spy = stubFetch(async () => Response.json({}));
    await expect(fetchPagbankCardPublicKey({ ...CONFIG, token: null })).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a non-2xx and a keyless body are both null, never a throw', async () => {
    stubFetch(async () => new Response('denied', { status: 403 }));
    await expect(fetchPagbankCardPublicKey(CONFIG)).resolves.toBeNull();

    stubFetch(async () => Response.json({}));
    await expect(fetchPagbankCardPublicKey(CONFIG)).resolves.toBeNull();
  });

  it('retries a pre-send network failure, then succeeds', async () => {
    const attempts = { count: 0 };
    const spy = stubFetch(async () => {
      attempts.count += 1;
      if (attempts.count === 1) throw new TypeError('fetch failed');
      return Response.json({ public_key: 'PUB_KEY_2' });
    });

    await expect(fetchPagbankCardPublicKey(CONFIG)).resolves.toBe('PUB_KEY_2');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and answers null', async () => {
    const spy = stubFetch(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(fetchPagbankCardPublicKey(CONFIG)).resolves.toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
