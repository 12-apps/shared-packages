import type {
  ExpiringConnection,
  MerchantFailoverPolicy,
  ProviderConfigStore,
  StoredProviderConfig,
} from './config/types';
import { PaymentsError } from './core/errors';
import { mergeRefreshedSnapshot } from './core/snapshot-merge';
import { isForwardTransition } from './core/status';
import type {
  AttemptLedger,
  ChargeAttemptRecord,
  ChargeQueryStore,
  ChargeStore,
  CredentialStore,
  PayableChargeQuery,
  StoredCharge,
} from './core/ports';
import { ownsReference } from './core/reference';
import type {
  ChargeSnapshot,
  MerchantRef,
  ProviderName,
  ResolvedCredentials,
} from './core/types';
import { merchantKey, scopedKey } from './memory-keys';

/**
 * In-memory port implementations — for tests, local development and any host
 * that has no database yet. Mirrors `@12-apps/entitlements`' `memory.ts`.
 * Nothing here is production storage.
 *
 * The webhook inbox lives next door in `memory-webhook-inbox.ts`: it is the one
 * fake carrying real policy (the replay sweep's eligibility rule), and it earns
 * a file where the others are plain maps.
 */

export interface MemoryCredentialStore extends CredentialStore {
  /**
   * Connect a merchant to a provider, APPENDING it to the failover chain —
   * so the call order in a test is the routing order.
   */
  set(merchant: MerchantRef, provider: ProviderName, credentials: ResolvedCredentials): void;
  /** Set the whole chain explicitly (reordering, or dropping a provider). */
  setChain(merchant: MerchantRef, ordered: readonly ProviderName[]): void;
  clear(): void;
}

export function createMemoryCredentialStore(): MemoryCredentialStore {
  const byMerchant = new Map<string, Map<ProviderName, ResolvedCredentials>>();
  // Insertion-ordered chain per merchant: index 0 is tried first.
  const chains = new Map<string, ProviderName[]>();

  return {
    async providerChain(merchant) {
      return [...(chains.get(merchantKey(merchant)) ?? [])];
    },
    async defaultProvider(merchant) {
      return chains.get(merchantKey(merchant))?.[0] ?? null;
    },
    async getCredentials(merchant, provider) {
      return byMerchant.get(merchantKey(merchant))?.get(provider) ?? null;
    },
    set(merchant, provider, credentials) {
      const key = merchantKey(merchant);
      const providers = byMerchant.get(key) ?? new Map<ProviderName, ResolvedCredentials>();
      providers.set(provider, credentials);
      byMerchant.set(key, providers);
      const chain = chains.get(key) ?? [];
      if (!chain.includes(provider)) chain.push(provider);
      chains.set(key, chain);
    },
    setChain(merchant, ordered) {
      chains.set(merchantKey(merchant), [...ordered]);
    },
    clear() {
      byMerchant.clear();
      chains.clear();
    },
  };
}

export interface MemoryChargeStore extends ChargeStore, ChargeQueryStore {
  all(): StoredCharge[];
  clear(): void;
}

/**
 * The payable-charge narrowing, in memory. Deliberately the SAME clause set the
 * Prisma store expresses as a `where` — a fake that filters more loosely than
 * production turns "the reuse rule holds" into a test that proves nothing about
 * the deployment it is standing in for.
 */
function matchesAmount(amount: StoredCharge['snapshot']['amount'], query: PayableChargeQuery): boolean {
  const money = query.amount ?? query.amountNot;
  if (!money) return true;
  // Currency rides with whichever amount clause was given: comparing cents
  // across currencies is how a 7500-centavo charge passes for a 7500-cent one.
  if (amount.currency !== money.currency) return false;
  return query.amount
    ? amount.amountCents === money.amountCents
    : amount.amountCents !== money.amountCents;
}

function matchesPayableQuery(row: StoredCharge, query: PayableChargeQuery): boolean {
  return (
    merchantKey(row.merchant) === merchantKey(query.merchant) &&
    ownsReference(query.reference, row.reference) &&
    row.snapshot.status === 'PENDING' &&
    (!query.method || row.snapshot.method === query.method) &&
    matchesAmount(row.snapshot.amount, query)
  );
}

/**
 * The checkout reads, over the same row list. Their own factory purely so
 * `createMemoryChargeStore` stays inside the size gate.
 */
function payableQueries(rows: readonly StoredCharge[]): ChargeQueryStore {
  /** Every attempt of one payable, in insertion order. */
  const ofPayable = (merchant: MerchantRef, reference: string): StoredCharge[] =>
    rows.filter(
      (row) =>
        merchantKey(row.merchant) === merchantKey(merchant) &&
        ownsReference(reference, row.reference),
    );

  return {
    async countByReference(merchant, reference) {
      return ofPayable(merchant, reference).length;
    },
    async latestByReference(merchant, reference) {
      // Insertion order for the same reason `listPayable` gives below, and NO
      // status clause at all — that is the whole difference between the two.
      return ofPayable(merchant, reference).at(-1) ?? null;
    },
    async listPayable(query) {
      // Newest first, and by INSERTION rather than by `createdAt`: several
      // charges of one walk are stored inside the same millisecond, and a
      // timestamp sort would then hand back an arbitrary one of them as "the
      // live charge". Insertion order is the only total order a fake has.
      return rows.filter((row) => matchesPayableQuery(row, query)).reverse();
    },
  };
}

/** The `(provider, providerChargeId)` UNIQUE constraint, as a map key. */
const chargeKey = (provider: ProviderName, providerChargeId: string): string =>
  `${provider}:${providerChargeId}`;

/**
 * Apply a refreshed snapshot to the row it names — the body of
 * `upsertByProviderChargeId`, outside the factory purely for the size gate.
 *
 * A row can live under the provider's ORDER id when the charge id did not
 * exist yet at creation (PagBank's unpaid PIX, FUT-681), so a snapshot that
 * carries the order id as a hint is looked up there SECOND — a real charge-id
 * match always wins — and the row is then RE-KEYED to the charge id, which is
 * what the next webhook, poll and refund will present.
 */
function applyRefreshedSnapshot(
  byChargeKey: Map<string, StoredCharge>,
  merchant: MerchantRef,
  snapshot: ChargeSnapshot,
): StoredCharge | null {
  const orderId = snapshot.settlementHints?.orderId;
  const row =
    byChargeKey.get(chargeKey(snapshot.provider, snapshot.providerChargeId)) ??
    (orderId && orderId !== snapshot.providerChargeId
      ? byChargeKey.get(chargeKey(snapshot.provider, orderId))
      : undefined);
  if (!row) return null;
  // Ownership check: a charge owned by another merchant is invisible to
  // this update — misattributed webhooks mutate nothing.
  if (merchantKey(row.merchant) !== merchantKey(merchant)) return null;
  if (!isForwardTransition(row.snapshot.status, snapshot.status)) return row;
  // Merged, not replaced — same rule as the Prisma store, so "refresh" means
  // the same thing in a test as in production.
  row.snapshot = mergeRefreshedSnapshot(row.snapshot, snapshot);
  if (row.providerChargeId !== row.snapshot.providerChargeId) {
    byChargeKey.delete(chargeKey(row.provider, row.providerChargeId));
    row.providerChargeId = row.snapshot.providerChargeId;
    byChargeKey.set(chargeKey(row.provider, row.providerChargeId), row);
  }
  row.updatedAt = new Date();
  return row;
}

export function createMemoryChargeStore(): MemoryChargeStore {
  const rows: StoredCharge[] = [];
  const byIdempotencyKey = new Map<string, StoredCharge>();
  const byChargeKey = new Map<string, StoredCharge>();
  let seq = 0;

  return {
    async findByProviderChargeId(provider, providerChargeId) {
      return byChargeKey.get(chargeKey(provider, providerChargeId)) ?? null;
    },
    async findByIdempotencyKey(merchant, key) {
      // Merchant-scoped: the same key string used by another merchant is a
      // different, unrelated charge.
      return byIdempotencyKey.get(scopedKey(merchant, key)) ?? null;
    },
    async create({ merchant, reference, snapshot, idempotencyKey }) {
      // Same insert-or-return semantics the real store's UNIQUE constraints
      // give: first on (merchant, idempotencyKey), then on
      // (provider, providerChargeId).
      if (idempotencyKey) {
        const held = byIdempotencyKey.get(scopedKey(merchant, idempotencyKey));
        if (held) return held;
      }
      const key = chargeKey(snapshot.provider, snapshot.providerChargeId);
      const existing = byChargeKey.get(key);
      if (existing) {
        // Charge identity never crosses merchants: an id collision under a
        // DIFFERENT merchant is a hard error, never that merchant's row.
        if (merchantKey(existing.merchant) !== merchantKey(merchant)) {
          throw new PaymentsError(
            'ProviderChainError',
            `providerChargeId ${snapshot.providerChargeId} (${snapshot.provider}) already belongs to another merchant`,
          );
        }
        return existing;
      }
      seq += 1;
      const row: StoredCharge = {
        id: `chg_${seq}`,
        merchant,
        provider: snapshot.provider,
        providerChargeId: snapshot.providerChargeId,
        reference,
        idempotencyKey: idempotencyKey ?? null,
        snapshot,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.push(row);
      byChargeKey.set(key, row);
      if (idempotencyKey) byIdempotencyKey.set(scopedKey(merchant, idempotencyKey), row);
      return row;
    },
    async upsertByProviderChargeId(merchant: MerchantRef, snapshot: ChargeSnapshot) {
      return applyRefreshedSnapshot(byChargeKey, merchant, snapshot);
    },
    ...payableQueries(rows),
    all() {
      return [...rows];
    },
    clear() {
      rows.length = 0;
      byChargeKey.clear();
      byIdempotencyKey.clear();
      seq = 0;
    },
  };
}

export interface MemoryProviderConfigStore extends ProviderConfigStore {
  clear(): void;
}

/**
 * One row's contribution to the renewal work list: itself if its grant lapses
 * by `before` and can still be renewed, nothing otherwise. Returning a list
 * rather than a nullable keeps the null-check and the narrowing in one place —
 * `expiresAt` is optional on the row and required on the result.
 */
function dueFrom(
  config: StoredProviderConfig,
  merchant: MerchantRef,
  before: Date,
): ExpiringConnection[] {
  if (!config.expiresAt || config.expiresAt > before) return [];
  // A dead grant is not renewable — the stored token is the one already refused.
  if (config.status === 'RECONNECT_REQUIRED') return [];
  return [{ merchant, provider: config.provider, expiresAt: config.expiresAt }];
}

/**
 * In-memory settings storage. The real implementation encrypts at rest
 * (`prisma/stores.ts` takes a cipher); this one is tests/dev only.
 */
export function createMemoryProviderConfigStore(): MemoryProviderConfigStore {
  const byMerchant = new Map<string, Map<string, StoredProviderConfig>>();
  const policies = new Map<string, MerchantFailoverPolicy>();

  return {
    // Reads hand out COPIES and `save` keeps one, exactly because the real
    // store does: Prisma rehydrates a fresh object per query, so a caller that
    // mutates what `get` returned and never calls `save` has persisted
    // nothing. Handing out the live object made that bug invisible here — the
    // service stamped `chargeVerifiedAt` on the shared reference, every test
    // observed it "saved", and production dropped it.
    async get(merchant, provider) {
      const config = byMerchant.get(merchantKey(merchant))?.get(provider);
      return config ? structuredClone(config) : null;
    },
    async list(merchant) {
      return [...(byMerchant.get(merchantKey(merchant))?.values() ?? [])].map((config) =>
        structuredClone(config),
      );
    },
    async save(merchant, config) {
      const key = merchantKey(merchant);
      const configs = byMerchant.get(key) ?? new Map<string, StoredProviderConfig>();
      configs.set(config.provider, structuredClone(config));
      byMerchant.set(key, configs);
    },
    async listExpiring(before, limit) {
      // A full scan, which the real store answers with an indexed query — the
      // point of the port is that only THIS side has to be dumb about it.
      const due = [...byMerchant].flatMap(([key, configs]) => {
        // `merchantKey` is a JSON tuple, never a delimiter join — see its note.
        const [kind, id] = JSON.parse(key) as [MerchantRef['kind'], string];
        return [...configs.values()].flatMap((config) => dueFrom(config, { kind, id }, before));
      });
      return due.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, limit);
    },
    async setProviderEnabled(merchant, provider, enabled) {
      // Read and write with no await between them, so no concurrent task can
      // observe — or start from — a half-applied chain.
      const configs = byMerchant.get(merchantKey(merchant));
      if (!configs?.has(provider)) return;
      const chain = [...configs.values()]
        .filter((c) => c.enabled)
        .sort((a, b) => a.priority - b.priority || a.provider.localeCompare(b.provider))
        .map((c) => c.provider)
        .filter((name) => name !== provider);
      if (enabled) chain.push(provider);
      for (const config of configs.values()) {
        const rank = chain.indexOf(config.provider);
        config.enabled = rank >= 0;
        config.priority = rank >= 0 ? rank : 0;
      }
    },

    async setProviderPriorities(merchant, ordered) {
      // Atomic by construction: no await between the mutations, so no other
      // task can observe a half-applied chain with duplicate ranks.
      const configs = byMerchant.get(merchantKey(merchant));
      if (!configs) return;
      for (const config of configs.values()) {
        const rank = ordered.indexOf(config.provider);
        config.enabled = rank >= 0;
        // Rank is meaningless while disabled; 0 keeps the row's shape valid
        // without implying a position in the chain.
        config.priority = rank >= 0 ? rank : 0;
      }
    },
    async getFailoverPolicy(merchant) {
      // Absent means TECHNICAL: cascading a decline is opt-in, never inherited.
      return policies.get(merchantKey(merchant)) ?? 'TECHNICAL';
    },
    async setFailoverPolicy(merchant, policy) {
      policies.set(merchantKey(merchant), policy);
    },
    clear() {
      byMerchant.clear();
      policies.clear();
    },
  };
}

export interface MemoryAttemptLedger extends AttemptLedger {
  all(): ChargeAttemptRecord[];
  clear(): void;
}

export function createMemoryAttemptLedger(): MemoryAttemptLedger {
  const rows: ChargeAttemptRecord[] = [];

  return {
    async record(attempt) {
      rows.push({ ...attempt });
    },
    async listByIdempotencyKey(merchant, key) {
      return rows.filter(
        (row) =>
          row.idempotencyKey === key && merchantKey(row.merchant) === merchantKey(merchant),
      );
    },
    all() {
      return [...rows];
    },
    clear() {
      rows.length = 0;
    },
  };
}
