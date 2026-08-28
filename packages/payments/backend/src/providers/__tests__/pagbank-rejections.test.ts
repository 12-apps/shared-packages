import { describe, expect, it } from 'vitest';

import { ProviderRequestError } from '../../core/errors';
import { classifyPagBankRejection } from '../pagbank-rejections';

/**
 * PagBank's error vocabulary, which is identical for every deployment and had
 * been carried by the first adopting host — so its checkout branched on another
 * company's error codes.
 */

const rejection = (reasons: unknown[], httpStatus = 400) =>
  new ProviderRequestError('pagbank', 'refused', {
    httpStatus,
    body: { error_messages: reasons },
  });

describe('classifying what PagBank refused', () => {
  it('reads a credentials problem off the status, not the body', () => {
    expect(classifyPagBankRejection(rejection([], 401))).toBe('ACCOUNT_ACCESS');
    expect(classifyPagBankRejection(rejection([], 403))).toBe('ACCOUNT_ACCESS');
  });

  /** The owner testing their own store is the one who meets this. */
  it('names the merchant-e-mail collision, which needs both code and parameter', () => {
    expect(
      classifyPagBankRejection(rejection([{ code: '40002', parameter_name: 'customer.email' }])),
    ).toBe('EMAIL_EQUALS_MERCHANT');
    // The same parameter under a different code is not that collision.
    expect(
      classifyPagBankRejection(rejection([{ code: '40001', parameter_name: 'customer.email' }])),
    ).toBeNull();
  });

  it('matches the tax id and the name by parameter substring', () => {
    expect(classifyPagBankRejection(rejection([{ parameter_name: 'customer.tax_id' }]))).toBe(
      'INVALID_TAX_ID',
    );
    expect(classifyPagBankRejection(rejection([{ parameter_name: 'customer.name' }]))).toBe(
      'INVALID_NAME',
    );
  });

  it('answers null for anything it does not recognise, rather than guessing', () => {
    expect(classifyPagBankRejection(rejection([{ parameter_name: 'items[0].amount' }]))).toBeNull();
    expect(classifyPagBankRejection(new Error('network'))).toBeNull();
    expect(classifyPagBankRejection(null)).toBeNull();
  });

  /**
   * The reason it reads structured reasons rather than the message: the adapter
   * caps a message at 300 characters, so a payload running past it silently
   * matched nothing.
   */
  it('does not depend on the message text', () => {
    const error = rejection([{ parameter_name: 'customer.tax_id' }]);
    expect(classifyPagBankRejection(error)).toBe('INVALID_TAX_ID');
  });
});
