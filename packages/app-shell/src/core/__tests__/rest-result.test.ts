/**
 * The FORM half of the API client — and why it exists beside `apiFetch`.
 *
 * `apiFetch` throws on a non-2xx, which is right for a read. A form submit has
 * two ordinary outcomes, one of which is "the server refused it and named the
 * fields", so writing that as a throw costs every submit handler a `try`/`catch`
 * whose catch IS the main path. These cases pin the fold: which shape a refusal
 * becomes, which facts survive it, and the one case that must not throw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { restResult } from '../rest-result';

/** A `fetch` that answers once, recording the request it was handed. */
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

describe('a call that worked', () => {
  it('R1: unwraps the envelope, so a caller reads its value and not a wrapper', async () => {
    stubFetch({ json: async () => ({ data: { id: 'x' } }) });
    expect(await restResult<{ id: string }>('/api/things')).toEqual({
      ok: true,
      data: { id: 'x' },
    });
  });

  it('R2: carries the session cookie, because the API is same-origin', async () => {
    const { calls } = stubFetch({ json: async () => ({ data: null }) });
    await restResult('/api/things');
    expect(calls[0]?.init?.credentials).toBe('same-origin');
  });

  it('R3: advertises a JSON body only when there IS one', async () => {
    const { calls } = stubFetch({ json: async () => ({ data: null }) });
    await restResult('/api/things/1', 'DELETE');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(calls[0]?.init?.body).toBeUndefined();

    await restResult('/api/things', 'POST', { name: 'x' });
    const posted = calls[1]?.init?.headers as Record<string, string>;
    expect(posted['Content-Type']).toBe('application/json');
    expect(calls[1]?.init?.body).toBe('{"name":"x"}');
  });

  it('R4: answers a 204 as ok with a null value rather than as a failure', async () => {
    // The body is unparseable because there is none. That is a SUCCESS, and a
    // fold that treated "no JSON" as an error would turn every bodyless write
    // into a refusal the operator has to interpret.
    stubFetch({ status: 204, json: async () => JSON.parse('') });
    expect(await restResult('/api/things/1', 'DELETE')).toEqual({ ok: true, data: null });
  });
});

describe('a call the server refused', () => {
  it('R5: keeps the sentence, the status and the per-field messages', async () => {
    stubFetch({
      ok: false,
      status: 422,
      json: async () => ({ error: 'Refused.', issues: { name: 'Too short.' } }),
    });
    expect(await restResult('/api/things', 'POST', {})).toEqual({
      ok: false,
      error: 'Refused.',
      status: 422,
      fieldErrors: { name: 'Too short.' },
    });
  });

  it('R6: keeps the status apart, because 403 and 409 are different answers', async () => {
    // "Not yours" belongs beside the button; "somebody was faster" is answered
    // with a refresh. Folding both into one sentence throws away the whole
    // reason an API answers with two codes.
    stubFetch({ ok: false, status: 409, json: async () => ({ error: 'Stale.' }) });
    const result = await restResult('/api/things/1', 'PATCH', {});
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result).not.toHaveProperty('fieldErrors');
  });

  it('R7: still says something when the refusal carried no sentence', async () => {
    stubFetch({ ok: false, status: 500, json: async () => JSON.parse('') });
    expect(await restResult('/api/things')).toEqual({ ok: false, error: 'HTTP 500', status: 500 });
  });
});

describe('a call nothing answered', () => {
  it('R8: folds a network failure instead of throwing it', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await restResult('/api/things')).toEqual({ ok: false, error: 'Failed to fetch' });
  });

  it('R9: leaves `status` ABSENT there, which is how a caller tells the two apart', async () => {
    // "The server said no" and "nothing answered" need different handling: one
    // is a message to show, the other is a retry. The presence of `status` is
    // the only signal that distinguishes them.
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await restResult('/api/things')).not.toHaveProperty('status');
  });
});
