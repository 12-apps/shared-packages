import { PaymentsError } from '../core/errors';
import type { ChargeStore, StoredCharge } from '../core/ports';
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

export interface ChargeDelegate {
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
    data: { snapshot: unknown; status: string };
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
 * Uniqueness note: `create` relies on the two UNIQUE constraints from the
 * owned migration — a cross-merchant `(provider, providerChargeId)` conflict
 * surfaces as the DB error, while an idempotency-key conflict is resolved by
 * re-reading the winning row.
 */
export function createPrismaChargeStore(delegate: ChargeDelegate): ChargeStore {
  return {
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
      const existing = await this.findByProviderChargeId(snapshot.provider, snapshot.providerChargeId);
      if (!existing) return null;
      if (existing.merchant.kind !== merchant.kind || existing.merchant.id !== merchant.id) return null;
      if (!isForwardTransition(existing.snapshot.status, snapshot.status)) return existing;
      const row = await delegate.update({
        where: { id: existing.id },
        data: { snapshot, status: snapshot.status },
      });
      return rowToStoredCharge(row);
    },
  };
}
