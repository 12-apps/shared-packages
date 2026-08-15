import { describe, expect, it } from 'vitest';

import { hasUsableCredentials } from '../config/usable-credentials';
import type { PaymentProviderAdapter } from '../core/provider';

/**
 * "Stored" is not "usable" (FUT-761, ported from the origin host). Two
 * real ways non-empty lies: a host-stamped extra field survives a CLEARED
 * token, and a set holding the token but missing a required sibling raises
 * charges nothing can confirm. The answer must come from the adapter's own
 * `credentialSchema` — a hand-kept table of key names is only ever wrong
 * silently.
 */

function adapterWithSchema(
  schema: { key: string; required?: boolean }[],
): PaymentProviderAdapter {
  return { credentialSchema: schema } as unknown as PaymentProviderAdapter;
}

const PAGBANK_LIKE = adapterWithSchema([
  { key: 'token', required: true },
  { key: 'webhookToken', required: true },
  { key: 'publicKey' },
]);

describe('hasUsableCredentials', () => {
  it('requires EVERY required field, not just any value', () => {
    expect(
      hasUsableCredentials(PAGBANK_LIKE, { token: 'live', webhookToken: 'wh' }),
    ).toBe(true);
    // The token alone raises charges nothing can confirm.
    expect(hasUsableCredentials(PAGBANK_LIKE, { token: 'live' })).toBe(false);
    expect(hasUsableCredentials(PAGBANK_LIKE, { token: 'live', webhookToken: '' })).toBe(false);
  });

  it('a host-stamped stranger field does not make a cleared set usable', () => {
    expect(
      hasUsableCredentials(PAGBANK_LIKE, {
        notificationUrl: 'https://store.example/webhooks',
      }),
    ).toBe(false);
  });

  it('a nothing-required schema (OAuth) still has to carry SOMETHING', () => {
    const oauth = adapterWithSchema([{ key: 'accessToken' }, { key: 'accountId' }]);
    expect(hasUsableCredentials(oauth, { accessToken: 'a' })).toBe(true);
    expect(hasUsableCredentials(oauth, {})).toBe(false);
    expect(hasUsableCredentials(oauth, undefined)).toBe(false);
  });
});
