import { describe, expect, it } from 'vitest';

import type { StoredProviderConfig } from '../config/types';
import { createMemoryProviderConfigStore } from '../memory';
import { createPrismaProviderConfigStore, type ProviderConfigDelegate } from '../prisma/config-store';
import { OTHER_TENANT, TENANT } from './fixtures';

/**
 * The renewal sweep's work list (FUT-490).
 *
 * `listExpiring` is the only cross-merchant read in the config store, and the
 * only one whose *exclusions* carry weight: a row it wrongly returns costs a
 * pointless outbound call, and a row it wrongly omits is a store that goes
 * dark when its grant lapses. Both implementations are pinned here — the
 * memory one because tests and dev run on it, the Prisma one because the
 * filter has to survive translation into a `where` clause.
 */

const BEFORE = new Date('2026-08-13T00:00:00.000Z');

function connection(overrides: Partial<StoredProviderConfig> = {}): StoredProviderConfig {
  return {
    provider: 'stone',
    enabled: true,
    priority: 0,
    environment: 'PRODUCTION',
    status: 'VERIFIED',
    lastVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
    chargeVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
    pendingVerification: null,
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    stub: false,
    environments: { SANDBOX: {}, PRODUCTION: { accessToken: 'at' } },
    ...overrides,
  };
}

describe('memory store listExpiring', () => {
  it('returns connections lapsing before the cutoff, across merchants', async () => {
    const store = createMemoryProviderConfigStore();
    await store.save(TENANT, connection());
    await store.save(OTHER_TENANT, connection({ provider: 'stripe' }));

    const due = await store.listExpiring(BEFORE, 10);

    expect(due).toEqual([
      { merchant: TENANT, provider: 'stone', expiresAt: new Date('2026-08-01T00:00:00.000Z') },
      { merchant: OTHER_TENANT, provider: 'stripe', expiresAt: new Date('2026-08-01T00:00:00.000Z') },
    ]);
  });

  it('leaves connections that lapse after the cutoff alone', async () => {
    const store = createMemoryProviderConfigStore();
    await store.save(TENANT, connection({ expiresAt: new Date('2026-12-01T00:00:00.000Z') }));

    expect(await store.listExpiring(BEFORE, 10)).toEqual([]);
  });

  it('skips rows with no expiry — a credential-mode provider is never due', async () => {
    const store = createMemoryProviderConfigStore();
    await store.save(TENANT, connection({ expiresAt: null }));

    expect(await store.listExpiring(BEFORE, 10)).toEqual([]);
  });

  it('skips RECONNECT_REQUIRED — its stored token is the one already refused', async () => {
    const store = createMemoryProviderConfigStore();
    await store.save(TENANT, connection({ status: 'RECONNECT_REQUIRED' }));

    expect(await store.listExpiring(BEFORE, 10)).toEqual([]);
  });

  it('honours the limit, taking the soonest to lapse first', async () => {
    const store = createMemoryProviderConfigStore();
    await store.save(TENANT, connection({ expiresAt: new Date('2026-08-10T00:00:00.000Z') }));
    await store.save(OTHER_TENANT, connection({ expiresAt: new Date('2026-08-02T00:00:00.000Z') }));

    const due = await store.listExpiring(BEFORE, 1);

    expect(due).toHaveLength(1);
    expect(due[0]?.merchant).toEqual(OTHER_TENANT);
  });
});

describe('prisma store listExpiring', () => {
  function delegate(): { calls: unknown[]; delegate: ProviderConfigDelegate } {
    const calls: unknown[] = [];
    const stub = {
      findUnique: async () => null,
      findMany: async (args: unknown) => {
        calls.push(args);
        return [
          {
            merchantKind: 'TENANT',
            merchantId: 'tenant-1',
            provider: 'stone',
            enabled: true,
            priority: 0,
            environment: 'PRODUCTION',
            status: 'VERIFIED',
            lastVerifiedAt: null,
            expiresAt: new Date('2026-08-01T00:00:00.000Z'),
            stub: false,
            credentials: 'cipher',
          },
          // A row the database somehow hands back without an expiry. The query
          // excludes these, so this only guards the mapping — but the mapping
          // is what would otherwise produce an `expiresAt: null` the caller's
          // type says cannot happen.
          {
            merchantKind: 'TENANT',
            merchantId: 'tenant-2',
            provider: 'stripe',
            enabled: true,
            priority: 0,
            environment: 'PRODUCTION',
            status: 'VERIFIED',
            lastVerifiedAt: null,
            expiresAt: null,
            stub: false,
            credentials: 'cipher',
          },
        ];
      },
      upsert: async () => undefined,
      update: async () => undefined,
      updateMany: async () => ({ count: 0 }),
    };
    return { calls, delegate: stub as unknown as ProviderConfigDelegate };
  }

  const cipher = { encrypt: (value: string) => value, decrypt: (value: string) => value };

  it('asks for expiring, renewable rows only — soonest first, bounded', async () => {
    const { calls, delegate: d } = delegate();
    const store = createPrismaProviderConfigStore(d, cipher, async (fn) =>
      fn({ paymentProviderConfig: d }),
    );

    await store.listExpiring(BEFORE, 25);

    expect(calls[0]).toEqual({
      where: { expiresAt: { not: null, lte: BEFORE }, status: { not: 'RECONNECT_REQUIRED' } },
      orderBy: { expiresAt: 'asc' },
      take: 25,
    });
  });

  it('drops any row that came back without an expiry rather than reporting a null one', async () => {
    const { delegate: d } = delegate();
    const store = createPrismaProviderConfigStore(d, cipher, async (fn) =>
      fn({ paymentProviderConfig: d }),
    );

    const due = await store.listExpiring(BEFORE, 25);

    expect(due).toEqual([
      {
        merchant: { kind: 'TENANT', id: 'tenant-1' },
        provider: 'stone',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
  });
});
