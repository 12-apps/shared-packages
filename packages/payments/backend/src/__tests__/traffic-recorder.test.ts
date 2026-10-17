import { afterEach, describe, expect, it, vi } from 'vitest';

import { recordedFetch, redactUrl, redactValue } from '../core/traffic-recorder';
import { recordTraffic } from '../platform/evidence/record';

/**
 * The traffic recorder's redaction (FUT-3696) — what may never reach an
 * evidence file. Pinned per class of secret, plus the one value that LOOKS
 * like a secret and must survive: PagBank's decline `code`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('redactValue', () => {
  it('given an OAuth body, then the code and every token are removed', () => {
    expect(
      redactValue({ grant_type: 'authorization_code', code: 'c-1', refresh_token: 'r-1', redirect_uri: 'u' }),
    ).toEqual({ grant_type: 'authorization_code', code: '***REDACTED***', refresh_token: '***REDACTED***', redirect_uri: 'u' });
  });

  it('given a card charge, then the blob, the PAN, the CVV and the vault id are removed', () => {
    const card = { encrypted: 'blob', number: '4539620659922097', security_code: '123', id: 'CARD_1', last_digits: '2097' };

    expect(redactValue({ payment_method: { card } })).toEqual({
      payment_method: {
        card: { encrypted: '***REDACTED***', number: '***REDACTED***', security_code: '***REDACTED***', id: '***REDACTED***', last_digits: '2097' },
      },
    });
  });

  it("given a decline, then PagBank's payment_response.code survives", () => {
    expect(redactValue({ payment_response: { code: '10002', message: 'NAO AUTORIZADO' } })).toEqual({
      payment_response: { code: '10002', message: 'NAO AUTORIZADO' },
    });
  });

  it('given a phone number outside a card, then it is kept', () => {
    expect(redactValue({ phones: [{ number: '999999999' }] })).toEqual({ phones: [{ number: '999999999' }] });
  });
});

describe('redactUrl', () => {
  it('given a callback URL, then the code and the live state are both removed', () => {
    expect(redactUrl('https://x.test/cb?code=abc&state=s1')).toBe(
      'https://x.test/cb?code=***REDACTED***&state=***REDACTED***',
    );
  });
});

describe('recordedFetch', () => {
  it('given a recording, then headers carrying credentials are removed and the rest kept', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));

    const outcome = await recordTraffic(() =>
      recordedFetch('https://x.test/a', {
        method: 'POST',
        headers: { Authorization: 'Bearer t-1', X_CLIENT_SECRET: 's-1', X_CLIENT_ID: 'cid', Cookie: 'k=v' },
        body: '{"token":"t-2"}',
      }),
    );

    expect(outcome.calls[0]).toMatchObject({
      requestHeaders: {
        authorization: expect.stringMatching(/^Bearer \*\*\*REDACTED\*\*\* \(sha256:[0-9a-f]{12}\)$/),
        x_client_secret: '***REDACTED***',
        x_client_id: 'cid',
        cookie: '***REDACTED***',
      },
      bearerFingerprint: expect.stringMatching(/^[0-9a-f]{12}$/),
      requestBody: { token: '***REDACTED***' },
      status: 200,
      responseBody: { ok: true },
    });
  });

  it('given no recording, then nothing is kept and the call is plain fetch', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await recordTraffic(async () => 'none');
    await recordedFetch('https://x.test/b');

    expect(outcome.calls).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('given a network failure, then it is recorded with no status and still thrown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));

    const outcome = await recordTraffic(() => recordedFetch('https://x.test/c'));

    expect(outcome.ok).toBe(false);
    expect(outcome.calls[0]).toMatchObject({ error: 'fetch failed' });
    expect(outcome.calls[0]?.status).toBeUndefined();
  });
});
