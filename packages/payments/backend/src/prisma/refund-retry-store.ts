import type { RefundRefusal } from '../core/refund-retry';
import type {
  NewRefundSeriesRow,
  RefundRetryStore,
  RefundSeriesRow,
  RefundSeriesSettlement,
} from '../core/refund-series-store';
import type { MerchantRef } from '../core/types';

/**
 * Prisma-backed {@link RefundRetryStore} over the OWNED `PaymentRefundRetry`
 * model (FUT-4740). Duck-typed like its siblings: the host passes its generated
 * delegate. Every write after the insert is an `updateMany` on `(id, version)`,
 * so the database decides which of two writers wins and the loser writes
 * nothing.
 */

interface RetryColumns {
  merchantKind: string;
  merchantId: string;
  provider: string;
  providerChargeId: string;
  reference: string;
  subject: string;
  boundTo: string;
  amountCents: number | null;
  cause: string | null;
  series: number;
  attempt: number;
  attempts: number | null;
  nextAt: Date | null;
  claimedAt: Date | null;
  exhausted: boolean;
  refusal: string | null;
  reported: boolean;
  settledAt: Date | null;
  settledHow: string | null;
}

interface RetryRow extends RetryColumns {
  id: string;
  version: number;
}

export interface RefundRetryDelegate {
  findUnique(args: {
    where: { provider_providerChargeId_subject: { provider: string; providerChargeId: string; subject: string } };
  }): Promise<RetryRow | null>;
  findMany(args: {
    where:
      | { merchantKind: string; merchantId: string; reference: string }
      | { settledAt: null; exhausted: false; nextAt: { lte: Date } };
    orderBy?: { nextAt: 'asc' };
    take?: number;
  }): Promise<RetryRow[]>;
  create(args: { data: RetryColumns }): Promise<RetryRow>;
  updateMany(args: { where: { id: string; version: number }; data: RetryColumns & { version: number } }): Promise<{ count: number }>;
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);
const date = (value: string | null): Date | null => (value ? new Date(value) : null);

function toRow(row: RetryRow): RefundSeriesRow {
  return {
    id: row.id,
    merchant: { kind: row.merchantKind, id: row.merchantId } as MerchantRef,
    provider: row.provider,
    providerChargeId: row.providerChargeId,
    reference: row.reference,
    subject: row.subject,
    boundTo: row.boundTo,
    amountCents: row.amountCents,
    cause: row.cause,
    series: row.series,
    attempt: row.attempt,
    ...(row.attempts !== null ? { of: row.attempts } : {}),
    nextAt: iso(row.nextAt),
    claimedAt: iso(row.claimedAt),
    exhausted: row.exhausted,
    refusal: row.refusal as RefundRefusal | null,
    reported: row.reported,
    settledAt: iso(row.settledAt),
    settledHow: row.settledHow as RefundSeriesSettlement | null,
    version: row.version,
  };
}

function columnsOf(row: NewRefundSeriesRow): RetryColumns {
  return {
    merchantKind: row.merchant.kind,
    merchantId: row.merchant.id,
    provider: row.provider,
    providerChargeId: row.providerChargeId,
    reference: row.reference,
    subject: row.subject,
    boundTo: row.boundTo,
    amountCents: row.amountCents,
    cause: row.cause,
    series: row.series,
    attempt: row.attempt,
    attempts: row.of ?? null,
    nextAt: date(row.nextAt),
    claimedAt: date(row.claimedAt),
    exhausted: row.exhausted,
    refusal: row.refusal,
    reported: row.reported,
    settledAt: date(row.settledAt),
    settledHow: row.settledHow,
  };
}

/** A unique violation: another writer inserted the row first. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

export function createPrismaRefundRetryStore(delegate: RefundRetryDelegate): RefundRetryStore {
  return {
    async find(provider, providerChargeId, subject) {
      const row = await delegate.findUnique({ where: { provider_providerChargeId_subject: { provider, providerChargeId, subject } } });
      return row ? toRow(row) : null;
    },
    async findByReference(merchant, reference) {
      const rows = await delegate.findMany({ where: { merchantKind: merchant.kind, merchantId: merchant.id, reference } });
      return rows.map(toRow);
    },
    async insert(row) {
      try {
        return toRow(await delegate.create({ data: columnsOf(row) }));
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },
    async saveIf(row, version) {
      const { count } = await delegate.updateMany({
        where: { id: row.id, version },
        data: { ...columnsOf(row), version: version + 1 },
      });
      return count === 1 ? { ...row, version: version + 1 } : null;
    },
    async due(now, limit) {
      const rows = await delegate.findMany({
        where: { settledAt: null, exhausted: false, nextAt: { lte: now } },
        orderBy: { nextAt: 'asc' },
        take: limit,
      });
      return rows.map(toRow);
    },
  };
}
