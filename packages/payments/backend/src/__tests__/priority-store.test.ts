import { describe, expect, it } from 'vitest';

import { createPrismaProviderConfigStore, type ProviderConfigDelegate } from '../prisma/config-store';
import { TENANT } from './fixtures';

/**
 * The Prisma chain rewrite (FUT-303).
 *
 * The database enforces distinct ranks among a merchant's ENABLED rows with a
 * partial unique index, and Postgres checks that index per statement rather
 * than at commit. So the ORDER of writes inside the transaction is itself a
 * correctness property, not an implementation detail: rewriting ranks in
 * place would transiently collide on the rank being vacated and blow up a
 * perfectly legal reorder. These tests pin that order.
 */

interface Row {
  merchantKind: string;
  merchantId: string;
  provider: string;
  enabled: boolean;
  priority: number;
  environment: string;
  status: string;
  lastVerifiedAt: Date | null;
  chargeVerifiedAt: Date | null;
  pendingVerification: unknown;
  expiresAt: Date | null;
  stub: boolean;
  credentials: string;
}

function row(provider: string, enabled: boolean, priority: number): Row {
  return {
    merchantKind: TENANT.kind,
    merchantId: TENANT.id,
    provider,
    enabled,
    priority,
    environment: 'SANDBOX',
    status: 'UNVERIFIED',
    lastVerifiedAt: null,
    chargeVerifiedAt: null,
    pendingVerification: null,
    expiresAt: null,
    stub: false,
    credentials: 'cipher',
  };
}

/**
 * A delegate that records the statements it receives AND enforces the real
 * partial unique index, so a rewrite that would collide in Postgres also
 * fails here instead of silently passing.
 */
function fakeDelegate(rows: Row[]) {
  const statements: string[] = [];

  function assertIndex(): void {
    const ranks = rows.filter((r) => r.enabled).map((r) => r.priority);
    if (new Set(ranks).size !== ranks.length) {
      throw new Error(`unique violation: duplicate enabled priority in [${ranks.join(', ')}]`);
    }
  }

  const delegate: ProviderConfigDelegate = {
    async findUnique({ where }) {
      const key = where.merchantKind_merchantId_provider;
      return rows.find((r) => r.provider === key.provider) ?? null;
    },
    async findMany() {
      return [...rows];
    },
    async upsert() {
      return undefined;
    },
    async update({ where, data }) {
      const key = where.merchantKind_merchantId_provider;
      statements.push(`update ${key.provider} enabled=${data.enabled} priority=${data.priority}`);
      const target = rows.find((r) => r.provider === key.provider);
      if (target) {
        target.enabled = data.enabled;
        target.priority = data.priority;
      }
      assertIndex();
      return undefined;
    },
    async updateMany({ data }) {
      statements.push(`updateMany enabled=${data.enabled}`);
      for (const r of rows) r.enabled = data.enabled;
      assertIndex();
      return undefined;
    },
  };

  return { delegate, statements };
}

const cipher = { encrypt: (s: string) => s, decrypt: (s: string) => s };

function storeOver(rows: Row[]) {
  const { delegate, statements } = fakeDelegate(rows);
  const store = createPrismaProviderConfigStore(delegate, cipher, async (fn) =>
    fn({ paymentProviderConfig: delegate }),
  );
  return { store, statements };
}

describe('setProviderPriorities', () => {
  it('clears the chain before assigning ranks, so a SWAP cannot collide', async () => {
    const rows = [row('alpha', true, 0), row('beta', true, 1)];
    const { store: configStore, statements } = storeOver(rows);

    // The swap that would fail if ranks were rewritten in place.
    await configStore.setProviderPriorities(TENANT, ['beta', 'alpha']);

    expect(statements).toEqual([
      'updateMany enabled=false',
      'update beta enabled=true priority=0',
      'update alpha enabled=true priority=1',
    ]);
    expect(rows.map((r) => [r.provider, r.enabled, r.priority])).toEqual([
      ['alpha', true, 1],
      ['beta', true, 0],
    ]);
  });

  it('disables everything omitted from the new chain', async () => {
    const rows = [row('alpha', true, 0), row('beta', true, 1), row('gamma', false, 0)];
    const { store: configStore } = storeOver(rows);

    await configStore.setProviderPriorities(TENANT, ['gamma']);

    expect(rows.filter((r) => r.enabled).map((r) => r.provider)).toEqual(['gamma']);
    expect(rows.find((r) => r.provider === 'gamma')?.priority).toBe(0);
  });

  it('takes payments offline on an empty chain', async () => {
    const rows = [row('alpha', true, 0)];
    const { store: configStore } = storeOver(rows);
    await configStore.setProviderPriorities(TENANT, []);
    expect(rows.every((r) => !r.enabled)).toBe(true);
  });

  it('rejects a chain naming the same provider twice', async () => {
    const rows = [row('alpha', true, 0)];
    const { store: configStore, statements } = storeOver(rows);

    await expect(configStore.setProviderPriorities(TENANT, ['alpha', 'alpha'])).rejects.toThrow(
      /appears twice/,
    );
    // Rejected BEFORE any write — a bad request must not leave the chain
    // half-rewritten, least of all with payments switched off.
    expect(statements).toEqual([]);
  });

  it('rejects a provider with no stored row before touching the chain', async () => {
    const rows = [row('alpha', true, 0)];
    const { store: configStore, statements } = storeOver(rows);

    await expect(configStore.setProviderPriorities(TENANT, ['alpha', 'ghost'])).rejects.toThrow(
      /ghost is not configured/,
    );
    expect(statements).toEqual([]);
    expect(rows[0]?.enabled).toBe(true);
  });

  it('reads the current chain INSIDE the transaction when toggling', async () => {
    // The regression this guards: computing the replacement chain in the
    // caller lets two overlapping toggles each start from the same snapshot,
    // so the later write silently discards the earlier one. The read must
    // happen within the same transaction as the write.
    const rows = [row('alpha', true, 0), row('beta', false, 0)];
    const { store: configStore, statements } = storeOver(rows);

    await configStore.setProviderEnabled(TENANT, 'beta', true);

    // The chain it wrote preserves alpha — proof it read current state rather
    // than being handed one.
    expect(rows.filter((r) => r.enabled).map((r) => [r.provider, r.priority])).toEqual([
      ['alpha', 0],
      ['beta', 1],
    ]);
    // And the read happened before any write in this transaction.
    expect(statements[0]).toBe('updateMany enabled=false');
  });

  it('disabling a provider closes the gap it leaves behind', async () => {
    const rows = [row('alpha', true, 0), row('beta', true, 1), row('gamma', true, 2)];
    const { store: configStore } = storeOver(rows);

    await configStore.setProviderEnabled(TENANT, 'beta', false);

    expect(
      rows
        .filter((r) => r.enabled)
        .sort((a, b) => a.priority - b.priority)
        .map((r) => [r.provider, r.priority]),
    ).toEqual([
      ['alpha', 0],
      ['gamma', 1],
    ]);
  });

  it('yields dense ranks starting at 0 for any chain length', async () => {
    const rows = [row('alpha', false, 0), row('beta', false, 0), row('gamma', false, 0)];
    const { store: configStore } = storeOver(rows);

    await configStore.setProviderPriorities(TENANT, ['gamma', 'alpha', 'beta']);

    const ranks = rows
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority)
      .map((r) => [r.provider, r.priority]);
    expect(ranks).toEqual([
      ['gamma', 0],
      ['alpha', 1],
      ['beta', 2],
    ]);
  });
});
