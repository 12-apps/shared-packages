import type { AttemptLedger, ChargeAttemptRecord } from '../core/ports';
import type { MerchantRef } from '../core/types';

/**
 * Prisma-backed failover audit trail over the OWNED `PaymentChargeAttempt`
 * model. Duck-typed like the other stores in this folder: the host passes its
 * generated delegate, so this package never imports a generated client.
 */

interface AttemptRow {
  merchantKind: string;
  merchantId: string;
  idempotencyKey: string | null;
  reference: string;
  provider: string;
  attemptNo: number;
  outcome: string;
  failureBucket: string | null;
  probeResult: string | null;
  providerChargeId: string | null;
  error: string | null;
}

export interface ChargeAttemptDelegate {
  create(args: { data: AttemptRow }): Promise<unknown>;
  findMany(args: {
    where: { merchantKind: string; merchantId: string; idempotencyKey: string };
    orderBy: { createdAt: 'asc' };
  }): Promise<AttemptRow[]>;
}

/**
 * Failover audit trail. Writes here must never break a charge that otherwise
 * succeeded — see the gateway, which records outcomes best-effort for exactly
 * that reason — so this implementation stays deliberately dumb: no upserts,
 * no read-modify-write, nothing that can deadlock against the charge insert.
 */
export function createPrismaAttemptLedger(delegate: ChargeAttemptDelegate): AttemptLedger {
  return {
    async record(attempt) {
      await delegate.create({
        data: {
          merchantKind: attempt.merchant.kind,
          merchantId: attempt.merchant.id,
          idempotencyKey: attempt.idempotencyKey ?? null,
          reference: attempt.reference,
          provider: attempt.provider,
          attemptNo: attempt.attemptNo,
          outcome: attempt.outcome,
          failureBucket: attempt.failureBucket ?? null,
          probeResult: attempt.probeResult ?? null,
          providerChargeId: attempt.providerChargeId ?? null,
          error: attempt.error ?? null,
        },
      });
    },
    async listByIdempotencyKey(merchant, key) {
      const rows = await delegate.findMany({
        where: { merchantKind: merchant.kind, merchantId: merchant.id, idempotencyKey: key },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => ({
        merchant: { kind: row.merchantKind as MerchantRef['kind'], id: row.merchantId },
        idempotencyKey: row.idempotencyKey,
        reference: row.reference,
        provider: row.provider,
        attemptNo: row.attemptNo,
        outcome: row.outcome as ChargeAttemptRecord['outcome'],
        failureBucket: row.failureBucket as ChargeAttemptRecord['failureBucket'],
        probeResult: row.probeResult as ChargeAttemptRecord['probeResult'],
        providerChargeId: row.providerChargeId,
        error: row.error,
      }));
    },
  };
}

