import { describe, expect, it } from 'vitest';

import { isAccountAccessError, isPermanentProviderRefusal, providerExchangeReport } from '../core/error-readers';
import { CredentialsError, PaymentsError, ProviderRequestError } from '../core/errors';

/**
 * The error-taxonomy readers ported from the origin host (FUT-761):
 * the printable request/response pair (FUT-489), the account-level-rejection
 * test, and "can waiting improve this refusal". Pinned here so hosts can
 * delete their copies and the answers cannot drift per adopter.
 */

const SNAPSHOT = {
  method: 'POST',
  url: 'https://api.example.test/orders',
  headers: { 'content-type': 'application/json', authorization: '[redacted]' },
  body: { reference_id: 'order-1--0' },
};

describe('providerExchangeReport', () => {
  it('renders the pair as one copyable block, response from options.body', () => {
    const error = new ProviderRequestError('pagbank', 'PagBank 400 Bad Request: …capped…', {
      httpStatus: 400,
      body: { error_messages: [{ code: '40002' }] },
      request: SNAPSHOT,
    });

    const report = providerExchangeReport('charge for order-1', error);

    expect(report).toContain('charge for order-1');
    expect(report).toContain('REQUEST POST https://api.example.test/orders');
    expect(report).toContain('  authorization: [redacted]');
    expect(report).toContain('{"reference_id":"order-1--0"}');
    expect(report).toContain('RESPONSE HTTP 400');
    // The body verbatim, NOT the capped message — the cap is what made the
    // original HTTP 502 undiagnosable.
    expect(report).toContain('{"error_messages":[{"code":"40002"}]}');
    expect(report).not.toContain('…capped…');
  });

  it('falls back to the message when the provider sent no parseable body', () => {
    const error = new ProviderRequestError('stone', 'Stone 503 Service Unavailable', {
      httpStatus: 503,
      request: { ...SNAPSHOT, body: undefined },
    });

    const report = providerExchangeReport('charge', error);

    expect(report).toContain('RESPONSE HTTP 503');
    expect(report).toContain('Stone 503 Service Unavailable');
  });

  it('answers null when there is no captured request to pair', () => {
    // Not a provider rejection at all…
    expect(providerExchangeReport('ctx', new Error('db down'))).toBeNull();
    // …and a rejection from an adapter that builds no snapshot.
    expect(
      providerExchangeReport('ctx', new ProviderRequestError('pagbank', 'PagBank 500', {})),
    ).toBeNull();
  });
});

describe('isAccountAccessError', () => {
  it('claims 401 and 403 — the statuses that reject the ACCOUNT, not the charge', () => {
    for (const httpStatus of [401, 403]) {
      expect(
        isAccountAccessError(new ProviderRequestError('pagbank', 'denied', { httpStatus })),
      ).toBe(true);
    }
  });

  it('leaves per-request failures and foreign errors alone', () => {
    expect(isAccountAccessError(new ProviderRequestError('pagbank', 'bad', { httpStatus: 400 }))).toBe(false);
    expect(isAccountAccessError(new ProviderRequestError('pagbank', 'down', { httpStatus: 503 }))).toBe(false);
    expect(isAccountAccessError(new ProviderRequestError('pagbank', 'no status', {}))).toBe(false);
    expect(isAccountAccessError(new Error('denied'))).toBe(false);
  });
});

describe('isPermanentProviderRefusal', () => {
  it('a retriable request error is the one refusal waiting can improve', () => {
    expect(
      isPermanentProviderRefusal(new ProviderRequestError('pagbank', 'timeout', { retriable: true })),
    ).toBe(false);
    expect(
      isPermanentProviderRefusal(new ProviderRequestError('pagbank', 'rejected', { retriable: false })),
    ).toBe(true);
  });

  it('any other PaymentsError is a definite verdict; a foreign fault is not', () => {
    expect(isPermanentProviderRefusal(new CredentialsError('pagbank', 'not connected'))).toBe(true);
    expect(isPermanentProviderRefusal(new PaymentsError('PaymentsError', 'no detach'))).toBe(true);
    // A bug on the caller's side of the seam must never read as permission
    // to treat a payment record as provider-refused.
    expect(isPermanentProviderRefusal(new TypeError('x is not a function'))).toBe(false);
  });
});
