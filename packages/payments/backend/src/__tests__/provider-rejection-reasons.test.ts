import { describe, expect, it } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import { providerRejectionReasons } from '../core/error-readers';

/**
 * READING THE REASONS OFF THE BODY, NOT OUT OF THE MESSAGE (FUT-760).
 *
 * Hosts branch on a provider's `error_messages` to turn a rejection into a
 * sentence a buyer can act on. The way they were all doing it — regexing the
 * JSON back out of `error.message` — is broken by the adapter's own message
 * cap, and the failure is silent: reasons parse to `[]`, and every specific
 * message collapses into the generic refusal.
 *
 * The last case is the one that matters. It is the exact shape future-pay's
 * `lib/payments/pagbank-reasons.ts` cannot read, and its own docstring admits
 * it ("a body truncated past the 300-char cap in the message").
 */

/** A rejection carrying both halves the adapter really produces. */
function rejection(body: unknown, message = 'PagBank 400 Bad Request'): ProviderRequestError {
  return new ProviderRequestError('pagbank', message, { httpStatus: 400, body });
}

describe('providerRejectionReasons', () => {
  it('reads code, description and parameterName off the structured body', () => {
    const error = rejection({
      error_messages: [
        { code: '40002', description: 'must be different', parameter_name: 'customer.email' },
      ],
    });

    expect(providerRejectionReasons(error)).toEqual([
      { code: '40002', description: 'must be different', parameterName: 'customer.email' },
    ]);
  });

  it('answers [] for anything that is not a provider rejection', () => {
    expect(providerRejectionReasons(new Error('nope'))).toEqual([]);
    expect(providerRejectionReasons(null)).toEqual([]);
    expect(providerRejectionReasons(rejection(undefined))).toEqual([]);
    expect(providerRejectionReasons(rejection('a string body'))).toEqual([]);
    expect(providerRejectionReasons(rejection({ error_messages: 'not an array' }))).toEqual([]);
  });

  it('skips entries that are not objects rather than inventing fields', () => {
    const error = rejection({ error_messages: ['just a string', null, { code: '40001' }] });
    expect(providerRejectionReasons(error)).toEqual([{ code: '40001' }]);
  });

  it('omits absent fields instead of carrying undefined', () => {
    const error = rejection({ error_messages: [{ code: '40002' }] });
    const [reason] = providerRejectionReasons(error);
    expect(reason).toEqual({ code: '40002' });
    expect('parameterName' in (reason ?? {})).toBe(false);
  });

  /**
   * THE REGRESSION THIS EXISTS FOR.
   *
   * The adapter caps the MESSAGE at 300 characters and passes the whole
   * payload separately. A body long enough to be truncated — many reasons, or
   * one wordy description — leaves the message holding a JSON fragment that
   * cannot parse, so a message-derived read returns nothing at exactly the
   * moment the provider said the most.
   */
  it('still reads a body whose JSON is truncated in the message', () => {
    const reasons = Array.from({ length: 12 }, (_, index) => ({
      code: '40002',
      description: `reason number ${index} with enough words to push the payload past the cap`,
      parameter_name: 'customer.email',
    }));
    const full = JSON.stringify({ error_messages: reasons });
    // The message the adapter actually builds: capped, and therefore invalid JSON.
    const capped = `PagBank 400 Bad Request: ${full.slice(0, 300)}`;
    expect(() => JSON.parse(capped.slice(capped.indexOf('{')))).toThrow();

    const parsed = providerRejectionReasons(rejection({ error_messages: reasons }, capped));
    expect(parsed).toHaveLength(12);
    expect(parsed[0]).toMatchObject({ code: '40002', parameterName: 'customer.email' });
  });
});
