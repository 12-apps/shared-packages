import { describe, expect, it } from 'vitest';

import { pagbankApiBase } from '../providers/pagbank-api-base';

/**
 * PagBank's Orders API hosts (FUT-760).
 *
 * These two cases pin what the helper ANSWERS. The property that matters just
 * as much — that nobody spells either host anywhere else — is not assertable
 * here: it needs a repo-wide source sweep, and a suite that reads the
 * filesystem fails for reasons unrelated to the code under test (which is
 * exactly what `test-flakiness/no-unmocked-fs` refuses). That half lives in
 * `scripts/pagbank-api-base-gate.mjs`, run from `quality:portability`.
 */

describe('pagbankApiBase', () => {
  it('answers the production host for PRODUCTION', () => {
    expect(pagbankApiBase('PRODUCTION')).toBe('https://api.pagseguro.com');
  });

  it('answers the sandbox host for SANDBOX', () => {
    expect(pagbankApiBase('SANDBOX')).toBe('https://sandbox.api.pagseguro.com');
  });
});
