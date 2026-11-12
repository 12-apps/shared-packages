import type { RefundRetryStore, RefundSeriesRow } from './core/refund-series-store';
import { merchantKey } from './memory-keys';

/**
 * The in-memory {@link RefundRetryStore} (FUT-4740), for tests and a host with
 * no database. `saveIf` compares and writes with no await between, so in one
 * process it is the same fence the Prisma store's conditional update is.
 */
export interface MemoryRefundRetryStore extends RefundRetryStore {
  all(): RefundSeriesRow[];
}

export function createMemoryRefundRetryStore(): MemoryRefundRetryStore {
  const rows = new Map<string, RefundSeriesRow>();
  const keyOf = (provider: string, providerChargeId: string, subject: string) => `${provider}\u0000${providerChargeId}\u0000${subject}`;
  let ids = 0;
  const copy = (row: RefundSeriesRow): RefundSeriesRow => ({ ...row, merchant: { ...row.merchant } });

  return {
    async find(provider, providerChargeId, subject) {
      const row = rows.get(keyOf(provider, providerChargeId, subject));
      return row ? copy(row) : null;
    },
    async findByReference(merchant, reference) {
      return [...rows.values()]
        .filter((row) => row.reference === reference && merchantKey(row.merchant) === merchantKey(merchant))
        .map(copy);
    },
    async insert(row) {
      const key = keyOf(row.provider, row.providerChargeId, row.subject);
      if (rows.has(key)) return null;
      ids += 1;
      const stored: RefundSeriesRow = { ...row, id: `refund-series-${ids}`, version: 0 };
      rows.set(key, stored);
      return copy(stored);
    },
    async saveIf(row, version) {
      const key = keyOf(row.provider, row.providerChargeId, row.subject);
      const current = rows.get(key);
      if (!current || current.version !== version) return null;
      const stored: RefundSeriesRow = { ...row, id: current.id, version: version + 1 };
      rows.set(key, stored);
      return copy(stored);
    },
    async due(now, limit) {
      return [...rows.values()]
        .filter((row) => row.settledAt === null && !row.exhausted && row.nextAt !== null && Date.parse(row.nextAt) <= now.getTime())
        .sort((a, b) => Date.parse(a.nextAt!) - Date.parse(b.nextAt!))
        .slice(0, limit)
        .map(copy);
    },
    all() {
      return [...rows.values()].map(copy);
    },
  };
}
