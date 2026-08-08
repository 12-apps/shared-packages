import type {
  ExpiringConnection,
  MerchantFailoverPolicy,
  PendingVerification,
  ProviderConfigStore,
  StoredProviderConfig,
} from '../config/types';
import { PaymentsError } from '../core/errors';
import type { MerchantRef, ProviderName } from '../core/types';

import type { Cipher } from './stores';

/**
 * Prisma-backed provider-configuration storage: the merchant's chain, its
 * ranks, the encrypted credential blob, and the merchant-level failover
 * policy.
 *
 * Split from `stores.ts` because it is the only store here with ATOMICITY
 * requirements — the chain rewrite and the enable toggle both read and write
 * inside one transaction, and the order of those writes is a correctness
 * property (see `makeSetProviderPriorities`).
 */

interface MerchantSettingsRow {
  failoverPolicy: string;
}

type MerchantSettingsWhere = {
  merchantKind_merchantId: { merchantKind: string; merchantId: string };
};

export interface MerchantSettingsDelegate {
  findUnique(args: { where: MerchantSettingsWhere }): Promise<MerchantSettingsRow | null>;
  upsert(args: {
    where: MerchantSettingsWhere;
    create: { merchantKind: string; merchantId: string; failoverPolicy: string };
    update: { failoverPolicy: string };
  }): Promise<unknown>;
}

interface ProviderConfigRow {
  merchantKind: string;
  merchantId: string;
  provider: string;
  enabled: boolean;
  priority: number;
  environment: string;
  status: string;
  lastVerifiedAt: Date | null;
  chargeVerifiedAt: Date | null;
  /** JSONB — a `PendingVerification`, or null when nothing is in flight. */
  pendingVerification: unknown;
  expiresAt: Date | null;
  stub: boolean;
  credentials: string;
}

export interface ProviderConfigDelegate {
  findUnique(args: {
    where: {
      merchantKind_merchantId_provider: { merchantKind: string; merchantId: string; provider: string };
    };
  }): Promise<ProviderConfigRow | null>;
  findMany(args: {
    where:
      | { merchantKind: string; merchantId: string }
      // The renewal sweep's work list: every merchant, expiry-ordered.
      | { expiresAt: { not: null; lte: Date }; status: { not: string } };
    orderBy?: { expiresAt: 'asc' };
    take?: number;
  }): Promise<ProviderConfigRow[]>;
  upsert(args: {
    where: {
      merchantKind_merchantId_provider: { merchantKind: string; merchantId: string; provider: string };
    };
    create: ProviderConfigRow;
    update: Omit<ProviderConfigRow, 'merchantKind' | 'merchantId' | 'provider'>;
  }): Promise<unknown>;
  update(args: {
    where: {
      merchantKind_merchantId_provider: { merchantKind: string; merchantId: string; provider: string };
    };
    data: { enabled: boolean; priority: number };
  }): Promise<unknown>;
  updateMany(args: {
    where: { merchantKind: string; merchantId: string; provider?: { not: string } };
    data: { enabled: boolean };
  }): Promise<unknown>;
}

/**
 * Minimal transaction runner — the host passes `prisma.$transaction`, so
 * the active-provider switch is one atomic unit without this package
 * importing a generated client.
 */
export type TransactionRunner = <T>(fn: (tx: { paymentProviderConfig: ProviderConfigDelegate }) => Promise<T>) => Promise<T>;

type ConfigWhere = (merchant: MerchantRef, provider: string) => {
  merchantKind_merchantId_provider: { merchantKind: string; merchantId: string; provider: string };
};

/**
 * Atomic whole-chain rewrite: clear the merchant's chain, then re-enable the
 * listed providers at their new ranks, all inside ONE transaction.
 *
 * The disable-everything-first step is not redundant — it is what makes a
 * REORDER possible at all. The unique index is partial (`WHERE enabled`), and
 * Postgres checks it per statement rather than at commit, so swapping two
 * providers' ranks in place would transiently collide on the rank being
 * vacated. Emptying the merchant's slice of the index first means every
 * subsequent enable inserts a rank nothing else holds.
 */
function makeSetProviderPriorities(transaction: TransactionRunner, whereOf: ConfigWhere) {
  return async function setProviderPriorities(
    merchant: MerchantRef,
    ordered: readonly ProviderName[],
  ): Promise<void> {
    const duplicate = ordered.find((name, index) => ordered.indexOf(name) !== index);
    if (duplicate) {
      throw new PaymentsError('ProviderChainError', `Provider ${duplicate} appears twice in the priority list`);
    }
    await transaction(async (tx) => {
      const rows = await tx.paymentProviderConfig.findMany({
        where: { merchantKind: merchant.kind, merchantId: merchant.id },
      });
      const configured = new Set(rows.map((row) => row.provider));
      const missing = ordered.find((name) => !configured.has(name));
      if (missing) {
        throw new PaymentsError('ProviderChainError', `Provider ${missing} is not configured for this merchant`);
      }
      await applyChain(tx, merchant, whereOf, ordered);
    });
  };
}

/** The write half of a chain rewrite; assumes every name is configured. */
async function applyChain(
  tx: { paymentProviderConfig: ProviderConfigDelegate },
  merchant: MerchantRef,
  whereOf: ConfigWhere,
  ordered: readonly ProviderName[],
): Promise<void> {
  await tx.paymentProviderConfig.updateMany({
    where: { merchantKind: merchant.kind, merchantId: merchant.id },
    data: { enabled: false },
  });
  for (const [index, provider] of ordered.entries()) {
    await tx.paymentProviderConfig.update({
      where: whereOf(merchant, provider),
      data: { enabled: true, priority: index },
    });
  }
}

/** The merchant's enabled providers, in rank order, from already-read rows. */
function chainFromRows(rows: readonly { provider: string; enabled: boolean; priority: number }[]) {
  return rows
    .filter((row) => row.enabled)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider))
    .map((row) => row.provider);
}

/**
 * Atomic single-provider toggle. The current chain is read INSIDE the
 * transaction that rewrites it, so two overlapping toggles cannot each start
 * from the same snapshot and silently discard one another's change.
 */
function makeSetProviderEnabled(transaction: TransactionRunner, whereOf: ConfigWhere) {
  return async function setProviderEnabled(
    merchant: MerchantRef,
    provider: ProviderName,
    enabled: boolean,
  ): Promise<void> {
    await transaction(async (tx) => {
      const rows = await tx.paymentProviderConfig.findMany({
        where: { merchantKind: merchant.kind, merchantId: merchant.id },
      });
      if (!rows.some((row) => row.provider === provider)) {
        throw new PaymentsError('ProviderChainError', `Provider ${provider} is not configured for this merchant`);
      }
      const chain = chainFromRows(rows).filter((name) => name !== provider);
      // Appended LAST: enabling must never silently outrank the provider the
      // merchant has been charging on.
      if (enabled) chain.push(provider);
      await applyChain(tx, merchant, whereOf, chain);
    });
  };
}


/**
 * The merchant-level failover policy, split out to keep the store factory
 * readable. Reads answer TECHNICAL when nothing is stored — cascading a
 * decline is opt-in, never inherited — while a write with no delegate wired
 * fails loudly rather than silently discarding the merchant's choice.
 */
function makeFailoverPolicy(settings?: MerchantSettingsDelegate) {
  const whereOf = (merchant: MerchantRef) => ({
    merchantKind_merchantId: { merchantKind: merchant.kind, merchantId: merchant.id },
  });
  return {
    async getFailoverPolicy(merchant: MerchantRef): Promise<MerchantFailoverPolicy> {
      const row = await settings?.findUnique({ where: whereOf(merchant) });
      return (row?.failoverPolicy as MerchantFailoverPolicy | undefined) ?? 'TECHNICAL';
    },
    async setFailoverPolicy(merchant: MerchantRef, policy: MerchantFailoverPolicy): Promise<void> {
      if (!settings) {
        throw new PaymentsError(
            'ProviderChainError',
          'failover policy storage is not wired: pass the PaymentMerchantSettings delegate',
        );
      }
      await settings.upsert({
        where: whereOf(merchant),
        create: { merchantKind: merchant.kind, merchantId: merchant.id, failoverPolicy: policy },
        update: { failoverPolicy: policy },
      });
    },
  };
}

/**
 * Narrow the JSONB column back to a {@link PendingVerification}.
 *
 * Validated rather than cast: the column is free-form to Postgres, and a row
 * written by an older build (or by hand) must degrade to "nothing in flight"
 * instead of handing the poller a reference-shaped `undefined` to ask about.
 */
function asPendingVerification(value: unknown): PendingVerification | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const { reference, checkoutUrl, slug, startedAt, phase } = candidate;
  if (typeof reference !== 'string' || typeof checkoutUrl !== 'string') return null;
  if (typeof startedAt !== 'string') return null;
  return {
    reference,
    checkoutUrl,
    startedAt,
    ...(typeof slug === 'string' ? { slug } : {}),
    // The card phase's write-ahead marker (FUT-679). Dropped here, a stranded
    // card attempt would come back looking like a redirect row and the sweep
    // would never consult the provider about it.
    ...(phase === 'CARD' ? { phase } : {}),
  };
}

function rowToConfig(row: ProviderConfigRow, cipher: Cipher): StoredProviderConfig {
  return {
    provider: row.provider,
    enabled: row.enabled,
    priority: row.priority,
    environment: row.environment as StoredProviderConfig['environment'],
    status: row.status as StoredProviderConfig['status'],
    lastVerifiedAt: row.lastVerifiedAt,
    chargeVerifiedAt: row.chargeVerifiedAt,
    pendingVerification: asPendingVerification(row.pendingVerification),
    expiresAt: row.expiresAt,
    stub: row.stub,
    environments: JSON.parse(cipher.decrypt(row.credentials)) as StoredProviderConfig['environments'],
  };
}

/**
 * The renewal sweep's work list. Answered by an indexed query rather than by
 * decrypting every merchant's blob, which is why `expiresAt` is a column.
 */
async function listExpiring(
  delegate: ProviderConfigDelegate,
  before: Date,
  limit: number,
): Promise<ExpiringConnection[]> {
  const rows = await delegate.findMany({
    where: {
      expiresAt: { not: null, lte: before },
      // A dead grant is not renewable — the stored token is exactly the one the
      // provider already rejected.
      status: { not: 'RECONNECT_REQUIRED' },
    },
    orderBy: { expiresAt: 'asc' },
    take: limit,
  });
  // `flatMap` rather than `map`, because the row's `expiresAt` is nullable and
  // the result's is not: a row without one is dropped instead of narrowed away
  // with an assertion the query happens to make true.
  return rows.flatMap((row) =>
    row.expiresAt
      ? [
          {
            merchant: { kind: row.merchantKind as MerchantRef['kind'], id: row.merchantId },
            provider: row.provider,
            expiresAt: row.expiresAt,
          },
        ]
      : [],
  );
}

export function createPrismaProviderConfigStore(
  delegate: ProviderConfigDelegate,
  cipher: Cipher,
  /**
   * `prisma.$transaction` — REQUIRED. Rewriting the failover chain must be
   * atomic: sequential writes can leave two providers sharing a rank, or none
   * enabled at all, which silently takes checkout offline.
   */
  transaction: TransactionRunner,
  /**
   * `PaymentMerchantSettings` delegate — where the merchant-level failover
   * policy lives. Optional so existing hosts keep compiling; omit it and
   * reads answer the safe default (TECHNICAL) while writes fail loudly rather
   * than silently discarding the merchant's choice.
   */
  settings?: MerchantSettingsDelegate,
): ProviderConfigStore {
  const whereOf = (merchant: MerchantRef, provider: string) => ({
    merchantKind_merchantId_provider: {
      merchantKind: merchant.kind,
      merchantId: merchant.id,
      provider,
    },
  });

  return {
    async get(merchant, provider) {
      const row = await delegate.findUnique({ where: whereOf(merchant, provider) });
      return row ? rowToConfig(row, cipher) : null;
    },
    async list(merchant) {
      const rows = await delegate.findMany({
        where: { merchantKind: merchant.kind, merchantId: merchant.id },
      });
      return rows.map((row) => rowToConfig(row, cipher));
    },
    listExpiring: (before, limit) => listExpiring(delegate, before, limit),
    async save(merchant, config) {
      const fields = {
        enabled: config.enabled,
        priority: config.priority,
        environment: config.environment,
        status: config.status,
        lastVerifiedAt: config.lastVerifiedAt,
        chargeVerifiedAt: config.chargeVerifiedAt,
        pendingVerification: config.pendingVerification,
        expiresAt: config.expiresAt,
        stub: config.stub,
        credentials: cipher.encrypt(JSON.stringify(config.environments)),
      };
      await delegate.upsert({
        where: whereOf(merchant, config.provider),
        create: {
          merchantKind: merchant.kind,
          merchantId: merchant.id,
          provider: config.provider,
          ...fields,
        },
        update: fields,
      });
    },
    setProviderPriorities: makeSetProviderPriorities(transaction, whereOf),
    setProviderEnabled: makeSetProviderEnabled(transaction, whereOf),
    ...makeFailoverPolicy(settings),
  };
}

