import { describe, expect, it } from 'vitest';

import { pagbankPlatformFallbackEnabled, readPagBankEnv } from '../pagbank-env';

/**
 * Which variables carry a PagBank credential, and the two defaults that decide
 * whether real money can move by accident.
 */

describe('reading the env-token configuration', () => {
  it('reads all four values', () => {
    expect(
      readPagBankEnv({
        PAGBANK_TOKEN: 'tok',
        PAGBANK_PUBLIC_KEY: 'pk',
        PAGBANK_WEBHOOK_TOKEN: 'wh',
        PAGBANK_API_BASE: 'https://example.test',
      }),
    ).toEqual({
      token: 'tok',
      publicKey: 'pk',
      webhookToken: 'wh',
      apiBase: 'https://example.test',
    });
  });

  it('treats blank and absent alike — a whitespace secret is no secret', () => {
    const env = readPagBankEnv({ PAGBANK_TOKEN: '   ', PAGBANK_PUBLIC_KEY: '' });
    expect(env.token).toBeNull();
    expect(env.publicKey).toBeNull();
  });

  it('trims a value someone pasted with a newline', () => {
    expect(readPagBankEnv({ PAGBANK_TOKEN: ' tok\n' }).token).toBe('tok');
  });

  /**
   * The safe direction, and the reason this reader exists rather than a bare
   * `pagbankApiBase` call: a deployment that forgot to configure a base must
   * talk to sandbox. Getting it backwards puts a real card through a real
   * account by accident.
   */
  it('defaults the base to SANDBOX, never to live', () => {
    expect(readPagBankEnv({}).apiBase).toBe('https://sandbox.api.pagseguro.com');
  });
});

describe('the platform fallback token', () => {
  /**
   * Production must charge into each store's OWN account. A deployment that
   * never thought about this gets the safe answer.
   */
  it('is off in production when nothing says otherwise', () => {
    expect(pagbankPlatformFallbackEnabled({ NODE_ENV: 'production' })).toBe(false);
  });

  it('is on elsewhere, so a local checkout exercises checkout with no setup', () => {
    expect(pagbankPlatformFallbackEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(pagbankPlatformFallbackEnabled({})).toBe(true);
  });

  it('can be forced either way', () => {
    expect(pagbankPlatformFallbackEnabled({ NODE_ENV: 'production', PAGBANK_PLATFORM_FALLBACK: '1' })).toBe(true);
    expect(pagbankPlatformFallbackEnabled({ NODE_ENV: 'production', PAGBANK_PLATFORM_FALLBACK: 'true' })).toBe(true);
    expect(pagbankPlatformFallbackEnabled({ PAGBANK_PLATFORM_FALLBACK: '0' })).toBe(false);
    expect(pagbankPlatformFallbackEnabled({ PAGBANK_PLATFORM_FALLBACK: 'false' })).toBe(false);
  });

  /** A typo in a flag must not read as an instruction. */
  it('falls through to the environment rule on anything else', () => {
    expect(pagbankPlatformFallbackEnabled({ NODE_ENV: 'production', PAGBANK_PLATFORM_FALLBACK: 'yes' })).toBe(false);
    expect(pagbankPlatformFallbackEnabled({ NODE_ENV: 'test', PAGBANK_PLATFORM_FALLBACK: 'sure' })).toBe(true);
  });
});
