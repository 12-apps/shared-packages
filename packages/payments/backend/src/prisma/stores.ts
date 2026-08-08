import { PaymentsError } from '../core/errors';
import type {
  ChargeQueryStore,
  ChargeStore,
  PayableChargeQuery,
  StoredCharge,
} from '../core/ports';
import { attemptReferencePrefix } from '../core/reference';
import { mergeRefreshedSnapshot } from '../core/snapshot-merge';
import { isForwardTransition } from '../core/status';
import type { ChargeSnapshot, MerchantRef } from '../core/types';

/**
 * Prisma-backed storage ports over the models this package OWNS
 * (`prisma/payments.prisma`). Deliberately duck-typed: the host passes its
 * generated client's delegates (structural interfaces below), so this package
 * never imports a generated Prisma client — the "self-contained" seam.
 *
 * The siblings hold the rest: `config-store.ts` (provider chain, credentials,
 * failover policy), `attempt-ledger.ts` (the failover audit trail) and
 * `webhook-inbox.ts`.
 *
 * Credentials encryption is INJECTED (`Cipher`) — declared here because the
 * config store takes one — so the database only ever sees ciphertext.
 */
export interface Cipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

interface ChargeRow {
  id: string;
  merchantKind: string;
  merchantId: string;
  provider: string;
  providerChargeId: string;
  reference: string;
  idempotencyKey: string | null;
  snapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The `where` a payable-scoped read is built from. Typed rather than `unknown`
 * so a drifted column name fails here instead of returning zero rows — a
 * silently empty answer would read as "no live charge" and mint a second
 * payable QR, which is the exact defect `checkout/reuse.ts` exists to stop.
 */
interface ChargeWhere {
  merchantKind: string;
  merchantId: string;
  /** Exact-or-`--`-suffix; see `core/reference.ts`. Never a bare prefix. */
  OR: Array<{ reference: string } | { reference: { startsWith: string } }>;
  status?: string;
  method?: string;
  amountCents?: number | { not: number };
  currency?: string;
}

export interface ChargeDelegate {
  count(args: { where: ChargeWhere }): Promise<number>;
  findMany(args: {
    where: ChargeWhere;
    orderBy: { createdAt: 'desc' };
    /** Row cap — the "newest one" reads take 1 rather than a payable's history. */
    take?: number;
  }): Promise<ChargeRow[]>;
  findUnique(args: {
    where:
      | { provider_providerChargeId: { provider: string; providerChargeId: string } }
      | {
          merchantKind_merchantId_idempotencyKey: {
            merchantKind: string;
            merchantId: string;
            idempotencyKey: string;
          };
        };
  }): Promise<ChargeRow | null>;
  create(args: { data: Omit<ChargeRow, 'id' | 'createdAt' | 'updatedAt'> & { status: string; method: string; amountCents: number; currency: string } }): Promise<ChargeRow>;
  update(args: {
    where: { id: string };
    data: {
      snapshot: unknown;
      status: string;
      amountCents: number;
      method: string;
      providerChargeId: string;
    };
  }): Promise<ChargeRow>;
}

function rowToStoredCharge(row: ChargeRow): StoredCharge {
  return {
    id: row.id,
    merchant: { kind: row.merchantKind as MerchantRef['kind'], id: row.merchantId },
    provider: row.provider,
    providerChargeId: row.providerChargeId,
    reference: row.reference,
    idempotencyKey: row.idempotencyKey,
    snapshot: row.snapshot as ChargeSnapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The columns a REFRESH writes — MERGED over the stored snapshot, never
 * replacing it, because a re-read answers what happened to the charge and must
 * not erase what creating it established ({@link mergeRefreshedSnapshot}).
 *
 * `amountCents` and `method` are rewritten alongside the snapshot deliberately:
 * they are what every lookup filters on, so leaving them behind lets a row
 * disagree with itself and hides a settled charge's real captured amount from
 * every query that reads it.
 *
 * `providerChargeId` is rewritten for the same reason (FUT-681): a PIX row is
 * created under the provider's ORDER id — the only id an unpaid PIX has — and
 * the refresh that learns the real charge id must RE-KEY the row, or every
 * later lookup by that id (the next webhook, a refund) misses it. For a
 * refresh found by its own id this writes the value already there.
 */
function refreshedRow(
  stored: ChargeSnapshot,
  refreshed: ChargeSnapshot,
): {
  snapshot: unknown;
  status: string;
  amountCents: number;
  method: string;
  providerChargeId: string;
} {
  const merged = mergeRefreshedSnapshot(stored, refreshed);
  return {
    snapshot: merged,
    status: merged.status,
    amountCents: merged.amount.amountCents,
    method: merged.method,
    providerChargeId: merged.providerChargeId,
  };
}

/** Every attempt reference of one payable, under one merchant. */
function referenceWhere(merchant: MerchantRef, reference: string): ChargeWhere {
  return {
    merchantKind: merchant.kind,
    merchantId: merchant.id,
    OR: [
      { reference },
      { reference: { startsWith: attemptReferencePrefix(reference) } },
    ],
  };
}

/** The payable-charge read, narrowed by whichever clauses the query carries. */
function payableWhere(query: PayableChargeQuery): ChargeWhere {
  const where = referenceWhere(query.merchant, query.reference);
  where.status = 'PENDING';
  if (query.method) where.method = query.method;
  const money = query.amount ?? query.amountNot;
  if (query.amount) where.amountCents = query.amount.amountCents;
  if (query.amountNot) where.amountCents = { not: query.amountNot.amountCents };
  // Currency rides with whichever amount clause was given: comparing cents
  // across currencies is how a 7500-centavo charge passes for a 7500-cent one.
  if (money) where.currency = money.currency;
  return where;
}

/**
 * The checkout reads. Their own factory purely so `createPrismaChargeStore`
 * stays inside the size gate.
 */
function payableQueries(delegate: ChargeDelegate): ChargeQueryStore {
  return {
    async countByReference(merchant, reference) {
      return delegate.count({ where: referenceWhere(merchant, reference) });
    },
    async latestByReference(merchant, reference) {
      // No status clause — deliberately the SAME row set `countByReference`
      // counts, newest first. A poll asks what became of the charge, so it must
      // still find one that has stopped being PENDING.
      const rows = await delegate.findMany({
        where: referenceWhere(merchant, reference),
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      const newest = rows[0];
      return newest ? rowToStoredCharge(newest) : null;
    },
    async listPayable(query) {
      const rows = await delegate.findMany({
        where: payableWhere(query),
        orderBy: { createdAt: 'desc' },
      });
      return rows.map(rowToStoredCharge);
    },
  };
}

/**
 * The stored row a refreshed snapshot names: by its charge id first, then —
 * when the snapshot labels a distinct ORDER id — by that (FUT-681). A PIX row
 * is created under the order id because an unpaid PIX has no charge id yet;
 * the paid webhook presents the real charge id plus the order-id hint, and
 * without the second lookup it updates nothing, forever.
 */
async function storedRowFor(
  store: Pick<ChargeStore, 'findByProviderChargeId'>,
  snapshot: ChargeSnapshot,
): Promise<StoredCharge | null> {
  const direct = await store.findByProviderChargeId(snapshot.provider, snapshot.providerChargeId);
  if (direct) return direct;
  const orderId = snapshot.settlementHints?.orderId;
  if (!orderId || orderId === snapshot.providerChargeId) return null;
  return store.findByProviderChargeId(snapshot.provider, orderId);
}

/**
 * Uniqueness note: `create` relies on the two UNIQUE constraints from the
 * owned migration — a cross-merchant `(provider, providerChargeId)` conflict
 * surfaces as the DB error, while an idempotency-key conflict is resolved by
 * re-reading the winning row.
 */
export function createPrismaChargeStore(
  delegate: ChargeDelegate,
): ChargeStore & ChargeQueryStore {
  return {
    ...payableQueries(delegate),
    async findByProviderChargeId(provider, providerChargeId) {
      const row = await delegate.findUnique({
        where: { provider_providerChargeId: { provider, providerChargeId } },
      });
      return row ? rowToStoredCharge(row) : null;
    },
    async findByIdempotencyKey(merchant, key) {
      const row = await delegate.findUnique({
        where: {
          merchantKind_merchantId_idempotencyKey: {
            merchantKind: merchant.kind,
            merchantId: merchant.id,
            idempotencyKey: key,
          },
        },
      });
      return row ? rowToStoredCharge(row) : null;
    },
    async create({ merchant, reference, snapshot, idempotencyKey }) {
      try {
        const row = await delegate.create({
          data: {
            merchantKind: merchant.kind,
            merchantId: merchant.id,
            provider: snapshot.provider,
            providerChargeId: snapshot.providerChargeId,
            reference,
            idempotencyKey: idempotencyKey ?? null,
            status: snapshot.status,
            method: snapshot.method,
            amountCents: snapshot.amount.amountCents,
            currency: snapshot.amount.currency,
            snapshot,
          },
        });
        return rowToStoredCharge(row);
      } catch (error) {
        // Unique-violation → someone else won the race; return their row IF
        // it is ours (idempotency), throw if the charge id belongs to
        // another merchant.
        if (idempotencyKey) {
          const winner = await this.findByIdempotencyKey(merchant, idempotencyKey);
          if (winner) return winner;
        }
        const existing = await this.findByProviderChargeId(
          snapshot.provider,
          snapshot.providerChargeId,
        );
        if (existing && existing.merchant.kind === merchant.kind && existing.merchant.id === merchant.id) {
          return existing;
        }
        if (existing) {
          throw new PaymentsError(
            'ChargeOwnershipError',
            `providerChargeId ${snapshot.providerChargeId} (${snapshot.provider}) already belongs to another merchant`,
            { cause: error },
          );
        }
        throw error;
      }
    },
    async upsertByProviderChargeId(merchant, snapshot) {
      // By charge id, or by the order-id hint — see `storedRowFor` (FUT-681).
      const existing = await storedRowFor(this, snapshot);
      if (!existing) return null;
      if (existing.merchant.kind !== merchant.kind || existing.merchant.id !== merchant.id) return null;
      if (!isForwardTransition(existing.snapshot.status, snapshot.status)) return existing;
      const row = await delegate.update({
        where: { id: existing.id },
        data: refreshedRow(existing.snapshot, snapshot),
      });
      return rowToStoredCharge(row);
    },
  };
}
