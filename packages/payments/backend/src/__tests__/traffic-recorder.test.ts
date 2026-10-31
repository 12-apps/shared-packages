import { afterEach, describe, expect, it, vi } from 'vitest';

import { maskDigits, recordedFetch, redactUrl, redactValue } from '../core/traffic-recorder';
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

  it('given a 3-D Secure session answer, then the session is removed and its expiry survives', () => {
    expect(redactValue({ session: 'S-1', expires_at: 1_800_000_000 })).toEqual({
      session: '***REDACTED***',
      expires_at: 1_800_000_000,
    });
  });

  it("given a decline, then PagBank's payment_response.code survives", () => {
    expect(redactValue({ payment_response: { code: '10002', message: 'NAO AUTORIZADO' } })).toEqual({
      payment_response: { code: '10002', message: 'NAO AUTORIZADO' },
    });
  });

  it("given a wallet charge, then the wallet's key is removed and its type survives (FUT-3755)", () => {
    const wallet = { type: 'GOOGLE_PAY', key: '{"signature":"MEU…","signedMessage":"…"}' };

    expect(redactValue({ charges: [{ payment_method: { type: 'CREDIT_CARD', card: { wallet } } }] })).toEqual({
      charges: [{ payment_method: { type: 'CREDIT_CARD', card: { wallet: { type: 'GOOGLE_PAY', key: '***REDACTED***' } } } }],
    });
  });

  it('given a key outside a card wallet, then it is kept — the rule is that narrow (FUT-3755)', () => {
    const body = { key: 'idem-1', wallet: { key: 'not-a-card' }, card: { key: 'k', holder: { wallet: { key: 'deep' } } } };

    expect(redactValue(body)).toEqual(body);
  });

  it('given a phone number outside a card, then it is masked to its last four, not removed as a card number (FUT-4198)', () => {
    expect(redactValue({ phones: [{ country: '55', area: '31', number: '994494408', type: 'MOBILE' }] })).toEqual({
      phones: [{ country: '55', area: '31', number: '*****4408', type: 'MOBILE' }],
    });
  });

  it("given a customer's CPF or CNPJ anywhere, then only its last two digits are kept (FUT-4198)", () => {
    expect(
      redactValue({ customer: { name: 'Ana', tax_id: '12345678909' }, card: { holder: { tax_id: '46556477000159' } } }),
    ).toEqual({ customer: { name: 'Ana', tax_id: '*********09' }, card: { holder: { tax_id: '************59' } } });
  });

  it('given a phone sent as one string, then it is masked the same way', () => {
    expect(redactValue({ customer: { phone: '+5531994494408' } })).toEqual({ customer: { phone: '**********4408' } });
  });

  it('given a number that is not a phone, then it is kept — an address or an order number is not masked', () => {
    const body = { address: { number: '424' }, items: [{ number: 2 }] };

    expect(redactValue(body)).toEqual(body);
  });
});

describe('maskDigits', () => {
  it('given a value no longer than what is kept, then every character is hidden', () => {
    expect(maskDigits('12', 2)).toBe('**');
  });

  it('given something that is not text or a number, then it is returned as it is', () => {
    expect(maskDigits(null, 2)).toBeNull();
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
