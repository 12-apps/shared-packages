import { describe, expect, it, vi } from 'vitest';

import { legacyNotificationCode, pagbankLegacyResolver } from '../pagbank-legacy-resolve';
import type { CredentialStore } from '../../core/ports';
import type { MerchantRef } from '../../core/types';
import type { NormalizedWebhookEvent } from '../../core/webhook-event-types';

vi.mock('../pagbank-legacy-notifications', () => ({
  resolvePagbankNotification: vi.fn().mockResolvedValue([{ eventId: 'resolved' }]),
}));

const TENANT: MerchantRef = { kind: 'TENANT', id: 'store_1' };

const parked = (raw: unknown, over: Record<string, unknown> = {}) =>
  ({ provider: 'pagbank', type: 'UNKNOWN', raw, ...over }) as unknown as NormalizedWebhookEvent;

function store(over: Partial<CredentialStore> = {}): CredentialStore {
  return {
    getCredentials: vi.fn().mockResolvedValue({ fields: {} }),
    ...over,
  } as unknown as CredentialStore;
}

describe('spotting a parked legacy delivery', () => {
  it('reads the code off exactly what this package parks', () => {
    expect(legacyNotificationCode(parked({ notificationCode: 'abc' }))).toBe('abc');
  });

  it('is not fooled by another provider, another type, or an empty code', () => {
    expect(legacyNotificationCode(parked({ notificationCode: 'abc' }, { provider: 'stone' }))).toBeNull();
    expect(
      legacyNotificationCode(parked({ notificationCode: 'abc' }, { type: 'CHARGE_UPDATED' })),
    ).toBeNull();
    expect(legacyNotificationCode(parked({ notificationCode: '' }))).toBeNull();
    expect(legacyNotificationCode(parked(null))).toBeNull();
  });
});

describe('resolving it', () => {
  it('leaves an unrelated event alone', async () => {
    expect(await pagbankLegacyResolver(store())(parked(null), TENANT)).toBeNull();
  });

  /**
   * A chargeback is about money that already moved, so whether the owner
   * currently routes NEW charges to PagBank is irrelevant.
   */
  it('prefers the LISTENING credentials when the store has them', async () => {
    const getConnectedCredentials = vi.fn().mockResolvedValue({ fields: {} });
    const credentials = store({ getConnectedCredentials });
    await pagbankLegacyResolver(credentials)(parked({ notificationCode: 'abc' }), TENANT);
    expect(getConnectedCredentials).toHaveBeenCalledWith(TENANT, 'pagbank');
    expect(credentials.getCredentials).not.toHaveBeenCalled();
  });

  it('falls back to the charging lookup for a store that predates it', async () => {
    const credentials = store();
    await pagbankLegacyResolver(credentials)(parked({ notificationCode: 'abc' }), TENANT);
    expect(credentials.getCredentials).toHaveBeenCalledWith(TENANT, 'pagbank');
  });

  /**
   * Swallowing this would drop a chargeback on the floor — the exact silence
   * the resolution exists to end. Throwing fails the inbox row with the reason
   * on `lastError`, and the drain's bounded retries come back for it.
   */
  it('THROWS when a resolvable delivery has no credentials behind it', async () => {
    const credentials = store({ getCredentials: vi.fn().mockResolvedValue(null) });
    await expect(
      pagbankLegacyResolver(credentials)(parked({ notificationCode: 'abc' }), TENANT),
    ).rejects.toThrow(/no pagbank credentials/);
  });

  it('hands back what the resolver made of the code', async () => {
    const resolved = await pagbankLegacyResolver(store())(parked({ notificationCode: 'abc' }), TENANT);
    expect(resolved).toEqual([{ eventId: 'resolved' }]);
  });
});
