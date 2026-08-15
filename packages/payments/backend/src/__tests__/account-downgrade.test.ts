import { describe, expect, it, vi } from 'vitest';

import { downgradeOnAccountError } from '../config/account-downgrade';
import type { ProviderConfigStore, StoredProviderConfig } from '../config/types';
import { ProviderRequestError } from '../core/errors';
import type { MerchantRef } from '../core/types';

/**
 * The account-level downgrade rule, ported from the origin host
 * (FUT-761): a 401/403 on a charge is the provider rejecting the MERCHANT'S
 * account, and without writing that to the connection row the settings screen
 * keeps showing a stale VERIFIED while every real charge fails — which is
 * exactly how the first production outage stayed invisible.
 */

const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'acme' };

function row(overrides: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  return {
    provider: 'pagbank',
    enabled: true,
    environment: 'PRODUCTION',
    environments: { PRODUCTION: { token: 't' }, SANDBOX: {} },
    status: 'VERIFIED',
    ...overrides,
  } as StoredProviderConfig;
}

function storeWith(stored: StoredProviderConfig | null) {
  const save = vi.fn(async () => undefined);
  const store = {
    get: vi.fn(async () => stored),
    save,
  } as unknown as ProviderConfigStore;
  return { store, save };
}

const ACCESS_DENIED = new ProviderRequestError(
  'pagbank',
  'PagBank 403 Forbidden',
  {
    httpStatus: 403,
    body: {
      error_messages: [{ code: 'ACCESS_DENIED', description: 'whitelist access required' }],
    },
  },
);

describe('downgradeOnAccountError', () => {
  it('marks the ENABLED connection FAILED and names the rejection, provider and merchant', async () => {
    const { store, save } = storeWith(row());
    const lines: string[] = [];

    await downgradeOnAccountError(store, MERCHANT, ACCESS_DENIED, (line) => lines.push(line));

    expect(save).toHaveBeenCalledWith(MERCHANT, expect.objectContaining({ status: 'FAILED' }));
    // The detail comes off the parsed body, not regexed out of the message.
    expect(lines[0]).toContain('HTTP 403: ACCESS_DENIED whitelist access required');
    expect(lines[0]).toContain('TENANT acme');
    expect(lines[0]).toContain('pagbank');
  });

  it('leaves a DISABLED row alone — it is not the one serving charges', async () => {
    const { store, save } = storeWith(row({ enabled: false }));

    await downgradeOnAccountError(store, MERCHANT, ACCESS_DENIED, () => undefined);

    expect(save).not.toHaveBeenCalled();
  });

  it('ignores per-request failures entirely: no read, no write, no log', async () => {
    const { store, save } = storeWith(row());
    const log = vi.fn();

    await downgradeOnAccountError(
      store,
      MERCHANT,
      new ProviderRequestError('pagbank', 'PagBank 400', { httpStatus: 400 }),
      log,
    );

    expect(store.get).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('never throws when the store fails — bookkeeping must not mask the charge error', async () => {
    const store = {
      get: vi.fn(async () => {
        throw new Error('db down');
      }),
      save: vi.fn(),
    } as unknown as ProviderConfigStore;
    const lines: string[] = [];

    await expect(
      downgradeOnAccountError(store, MERCHANT, ACCESS_DENIED, (line) => lines.push(line)),
    ).resolves.toBeUndefined();

    expect(lines.some((line) => line.includes('db down'))).toBe(true);
  });
});
