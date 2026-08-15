import { describe, expect, it } from 'vitest';

import { ensurePlatformCredentials, type PlatformCredentialSeed } from '../config/platform-seed';
import type { MerchantRef } from '../core/types';
import { createMemoryProviderConfigStore } from '../memory';

/**
 * The platform credential bootstrap (FUT-761, ported from the origin
 * host). The load-bearing rules, each of which has already bitten once:
 * seeding NEVER overwrites a stored set (FUT-409 — the panel owns, the env
 * bootstraps), the chain order is written only when no chain existed yet,
 * re-seeding must not claim a rotated secret is verified across an
 * environment switch, and `chargeVerifiedAt` is carried but never invented.
 */

const PLATFORM: MerchantRef = { kind: 'PLATFORM', id: 'platform' };

const seed = (overrides: Partial<PlatformCredentialSeed> = {}): PlatformCredentialSeed => ({
  provider: 'pagbank',
  environment: 'PRODUCTION',
  fields: { token: 'env-token', webhookToken: 'env-webhook' },
  ...overrides,
});

describe('ensurePlatformCredentials', () => {
  it('seeds an empty store: enabled row, hard-false stub, order chosen once', async () => {
    const store = createMemoryProviderConfigStore();

    const providers = await ensurePlatformCredentials(store, PLATFORM, [
      seed(),
      seed({ provider: 'stripe', fields: { secretKey: 'sk' } }),
    ]);

    expect(providers).toEqual(['pagbank', 'stripe']);
    const rows = await store.list(PLATFORM);
    expect(rows.map((row) => row.provider).sort()).toEqual(['pagbank', 'stripe']);
    for (const row of rows) {
      expect(row.enabled).toBe(true);
      expect(row.stub).toBe(false);
      expect(row.status).toBe('UNVERIFIED');
      expect(row.pendingVerification).toBeNull();
    }
  });

  it('never overwrites stored fields — the panel owns, the env bootstraps (FUT-409)', async () => {
    const store = createMemoryProviderConfigStore();
    await ensurePlatformCredentials(store, PLATFORM, [seed()]);
    const first = await store.get(PLATFORM, 'pagbank');
    await store.save(PLATFORM, {
      ...first!,
      environments: { ...first!.environments, PRODUCTION: { token: 'panel-token' } },
    });

    await ensurePlatformCredentials(store, PLATFORM, [seed()]);

    const after = await store.get(PLATFORM, 'pagbank');
    // The operator's panel save survives the next boot's re-seed.
    expect(after?.environments.PRODUCTION).toEqual({ token: 'panel-token' });
  });

  it('leaves an existing chain order alone — a deploy must not undo the operator', async () => {
    const store = createMemoryProviderConfigStore();
    await ensurePlatformCredentials(store, PLATFORM, [
      seed(),
      seed({ provider: 'stripe', fields: { secretKey: 'sk' } }),
    ]);
    // The operator flips the order in the panel.
    await store.setProviderPriorities(PLATFORM, ['stripe', 'pagbank']);

    // Next boot: same seeds again (fields stored → nothing writes), and the
    // chain must stay the operator's.
    await ensurePlatformCredentials(store, PLATFORM, [
      seed(),
      seed({ provider: 'stripe', fields: { secretKey: 'sk' } }),
    ]);

    const rows = await store.list(PLATFORM);
    const ordered = rows
      .filter((row) => row.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map((row) => row.provider);
    expect(ordered).toEqual(['stripe', 'pagbank']);
  });

  it('an environment switch re-verifies; same-environment reseed carries the status', async () => {
    const store = createMemoryProviderConfigStore();
    await ensurePlatformCredentials(store, PLATFORM, [seed({ environment: 'SANDBOX', fields: { token: 't' } })]);
    const stored = await store.get(PLATFORM, 'pagbank');
    const verifiedAt = new Date('2026-08-01T00:00:00Z');
    await store.save(PLATFORM, {
      ...stored!,
      status: 'VERIFIED',
      chargeVerifiedAt: verifiedAt,
      // Clear the fields so the next seed is allowed to write again.
      environments: { SANDBOX: {}, PRODUCTION: {} },
    });

    await ensurePlatformCredentials(store, PLATFORM, [seed({ environment: 'PRODUCTION' })]);

    const after = await store.get(PLATFORM, 'pagbank');
    // Rotated INTO another environment: never still "verified"…
    expect(after?.status).toBe('UNVERIFIED');
    // …but a real charge that once succeeded is history, not a claim — carried.
    expect(after?.chargeVerifiedAt).toEqual(verifiedAt);
  });

  it('no seeds is a no-op, not an error — the state every environment starts in', async () => {
    const store = createMemoryProviderConfigStore();
    await expect(ensurePlatformCredentials(store, PLATFORM, [])).resolves.toEqual([]);
    expect(await store.list(PLATFORM)).toEqual([]);
  });
});
