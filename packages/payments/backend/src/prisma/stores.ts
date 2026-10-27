import { PaymentsError } from '../core/errors';
import type {
  ChargeQueryStore,
  ChargeStore,
  PayableChargeQuery,
  StoredCharge,
} from '../core/ports';
import { attemptReferencePrefix } from '../core/reference';
import { isSuperseded } from '../core/supersession';
import type { ChargeSnapshot, MerchantRef } from '../core/types';

import { markSupersededRow, transitionPendingRow, upsertRow } from './charge-writes';

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
/** The sweep's where-shape: still-waiting statuses inside an age window. */
interface PendingChargesWhere {
  status: { in: string[] };
  createdAt: { lt: Date; gt: Date };
}

interface ChargeWhere {
  merchantKind: string;
  merchantId: string;
  /** Exact-or-`--`-suffix; see `core/reference.ts`. Never a bare prefix. */
  OR: Array<{ reference: string } | { reference: { startsWith: string } }>;
  status?: string | { in: string[] };
  method?: string;
  amountCents?: number | { not: number };
  currency?: string;
}

export interface ChargeDelegate {
  count(args: { where: ChargeWhere }): Promise<number>;
  findMany(args: {
    // The sweep's cross-merchant pending read (FUT-761) has no reference
    // clause and windows on age, so `where` is the union of both shapes.
    where: ChargeWhere | PendingChargesWhere;
    orderBy: { createdAt: 'desc' | 'asc' };
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
  /**
   * Every write to a charge row: a compare-and-set on the row's `updatedAt`
   * (its version) and, for `transitionPending`, its status. Prisma answers how
   * many rows matched — see `charge-writes.ts`.
   */
  updateMany(args: {
    where: { id: string; updatedAt: Date; status?: string };
    data: { snapshot: unknown; status: string; amountCents: number; method: string; providerChargeId: string };
  }): Promise<{ count: number }>;
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

/** How many of a payable's newest rows the poll looks through for one not superseded. */
const LATEST_WINDOW = 25;

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
      // still find one that has stopped being PENDING. A row this package marked
      // SUPERSEDED is skipped (FUT-4072): the poll tracks what the buyer holds.
      const rows = await delegate.findMany({
        where: referenceWhere(merchant, reference),
        orderBy: { createdAt: 'desc' },
        take: LATEST_WINDOW,
      });
      const newest = rows.map(rowToStoredCharge).find((row) => !isSuperseded(row.snapshot));
      return newest ?? null;
    },
    async listPayable(query) {
      const rows = await delegate.findMany({
        where: payableWhere(query),
        orderBy: { createdAt: 'desc' },
      });
      // The supersede mark lives in the snapshot (FUT-4072, `core/supersession.ts`)
      // and a payable holds a handful of rows, so it is filtered here, not in SQL.
      return rows.map(rowToStoredCharge).filter((row) => !isSuperseded(row.snapshot));
    },
    async listPendingCharges(window) {
      // PENDING/AUTHORIZED = `isTerminal`'s complement, spelled as an `in`
      // so the filter runs in SQL. Oldest first — the sweep's fairness
      // order: a full batch must never starve the longest-waiting charge.
      const rows = await delegate.findMany({
        where: {
          status: { in: ['PENDING', 'AUTHORIZED'] },
          createdAt: { lt: window.before, gt: window.after },
        },
        orderBy: { createdAt: 'asc' },
        take: window.limit,
      });
      return rows.map(rowToStoredCharge);
    },
  };
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
        // Unique-violation: return the winner's row IF ours, else throw (another merchant's id).
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
    upsertByProviderChargeId(merchant, snapshot) {
      return upsertRow(delegate, this, merchant, snapshot);
    },
    markSuperseded(merchant, provider, providerChargeId, supersession) {
      return markSupersededRow(delegate, this, merchant, { provider, providerChargeId }, supersession);
    },
    transitionPending(merchant, snapshot) {
      return transitionPendingRow(delegate, this, merchant, snapshot);
    },
  };
}
