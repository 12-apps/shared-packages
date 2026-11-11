import type { RefundRetryState } from './refund-retry';
import type { MerchantRef } from './types';

/**
 * The store a store refund's retry series is kept in (FUT-4740): one row per
 * `(provider, providerChargeId, subject)`, merchant-scoped, never joined to a
 * host table. Every write after the insert is a compare-and-set on `version`,
 * which is the one fence the sweep, the person's press and the person's hand
 * acts share: a loser sends nothing and writes nothing.
 */

/** How a series ended. */
export type RefundSeriesSettlement =
  /** A later attempt refunded. */
  | 'REFUNDED'
  /** A consult (or the adapter's read-back) found the money already back. */
  | 'ADOPTED'
  /** A person settled it: in the provider's panel, as store credit, or another way. */
  | 'BY_HAND'
  /** The pedido moved on (undone, re-cancelled, refunded elsewhere): nothing is owed through it. */
  | 'ENDED';

/** What a host opens a series under: the charge, the thing refunded, and what it was bound to. */
export interface RefundSeriesKey {
  merchant: MerchantRef;
  provider: string;
  providerChargeId: string;
  /** The host's id of what was paid for (the order). */
  reference: string;
  /** What is refunded: `order` for the whole, `problem-report:<id>` for a part. */
  subject: string;
  /** What the series was opened for (the cancel's `canceledAt`, a report id): a series for another one is not this one. */
  boundTo: string;
  /** The host's cause, carried into every trail entry. */
  cause?: string | null;
  /** A part's amount in cents; absent or null for the whole charge. */
  amountCents?: number | null;
}

/** A stored series. */
export interface RefundSeriesRow extends RefundRetryState {
  id: string;
  merchant: MerchantRef;
  provider: string;
  providerChargeId: string;
  reference: string;
  subject: string;
  boundTo: string;
  amountCents: number | null;
  cause: string | null;
  settledAt: string | null;
  settledHow: RefundSeriesSettlement | null;
  /** The compare-and-set counter: every write asks for the version it read. */
  version: number;
}

/** A row about to be inserted: everything but what the store stamps. */
export type NewRefundSeriesRow = Omit<RefundSeriesRow, 'id' | 'version'>;

export interface RefundRetryStore {
  /** The row for the charge and subject, settled or not. */
  find(provider: string, providerChargeId: string, subject: string): Promise<RefundSeriesRow | null>;
  /** The rows kept for one reference (an order), settled or not. */
  findByReference(merchant: MerchantRef, reference: string): Promise<RefundSeriesRow[]>;
  /** Insert a new row; null when one already exists for the charge and subject (the other writer won). */
  insert(row: NewRefundSeriesRow): Promise<RefundSeriesRow | null>;
  /** Write `row` if the stored version is still `version`; answers the stored row (version + 1), or null when it moved. */
  saveIf(row: RefundSeriesRow, version: number): Promise<RefundSeriesRow | null>;
  /** Unsettled, not exhausted rows whose `nextAt` came, oldest first. One indexed query. */
  due(now: Date, limit: number): Promise<RefundSeriesRow[]>;
}
