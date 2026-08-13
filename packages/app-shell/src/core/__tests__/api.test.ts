/**
 * `ApiError`'s SHAPE is a published contract, not an implementation detail (12-18).
 *
 * `@12-apps/entitlements`' upsell channel decides whether a rejection is a plan
 * denial by reading `status` and `body` off one of these — and it is already
 * published against the private `@repo/spa-shared/api` this replaces. So a `status`
 * that stopped being a number, or a `body` that stopped being the parsed payload,
 * would turn a 402 into an unhandled error in a host that never changed a line.
 * These cases exist so that regression is red HERE rather than in someone's app.
 *
 * The `name` matters for the same reason: an `instanceof` check does not survive two
 * copies of the class in one bundle (two versions of a package, a duplicated
 * install), so consumers fall back to `error.name === 'ApiError'`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiFetch } from '../api';

/** A `fetch` that answers exactly once, recording what it was called with. */
function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): {
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return { ok: true, status: 200, json: async () => ({}), ...response } as Response;
  });
  return { calls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiError', () => {
  it('carries the status and the parsed body, under a stable name', () => {
    const error = new ApiError(402, { error: 'plano', feature: 'reports' });
    expect(error.name).toBe('ApiError');
    expect(error.status).toBe(402);
    expect(error.body).toEqual({ error: 'plano', feature: 'reports' });
    expect(error).toBeInstanceOf(Error);
  });

  it('falls back to a message naming the status when none is given', () => {
    expect(new ApiError(500, null).message).toBe('API request failed with status 500');
  });
});

describe('apiFetch', () => {
  it('sends credentials and asks for JSON', async () => {
    const { calls } = stubFetch({ json: async () => ({ data: 1 }) });
    await apiFetch('/api/thing');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
    expect((calls[0]?.init?.headers as Record<string, string>).Accept).toBe('application/json');
    // No body, so no Content-Type: a GET that declares one is a request some
    // proxies and some frameworks treat differently.
    expect((calls[0]?.init?.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('serializes a body and declares its type', async () => {
    const { calls } = stubFetch({ json: async () => ({}) });
    await apiFetch('/api/thing', { method: 'POST', body: { a: 1 } });
    expect(calls[0]?.init?.body).toBe('{"a":1}');
    expect((calls[0]?.init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    );
  });

  it('resolves undefined for a 204 rather than parsing an empty body', async () => {
    stubFetch({
      status: 204,
      json: async () => {
        throw new Error('a 204 has no body to parse');
      },
    });
    await expect(apiFetch('/api/thing', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('throws an ApiError carrying the status and the parsed error body', async () => {
    stubFetch({ ok: false, status: 402, json: async () => ({ error: 'plano', code: 'x' }) });
    const error = await apiFetch('/api/thing').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(402);
    expect((error as ApiError).body).toEqual({ error: 'plano', code: 'x' });
  });

  it('takes the message from `error`, then from `message`', async () => {
    stubFetch({ ok: false, status: 403, json: async () => ({ error: 'sem permissão' }) });
    await expect(apiFetch('/api/thing')).rejects.toThrow('sem permissão');

    vi.unstubAllGlobals();
    stubFetch({ ok: false, status: 400, json: async () => ({ message: 'campo inválido' }) });
    await expect(apiFetch('/api/thing')).rejects.toThrow('campo inválido');
  });

  /**
   * A gateway's 502 is HTML, and a caller must still get a usable `status`. Before
   * this the rejected promise carried the JSON parse failure instead, so an
   * interceptor keyed on `status` saw nothing it recognised.
   */
  it('survives a non-JSON error body, keeping the status', async () => {
    stubFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });
    const error = await apiFetch('/api/thing').catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(502);
    expect((error as ApiError).body).toBeNull();
    expect((error as ApiError).message).toBe('API request failed with status 502');
  });
});

/*
 * `joinApiPath` moved to `./paths.test.ts` with the trailing-slash strip it is built
 * on — the differential table there covers this surface and a great deal more.
 */
