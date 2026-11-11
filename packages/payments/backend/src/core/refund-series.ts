import type { ProviderFailureReporter } from './provider-failure';
import type { RefundRefusal } from './refund-retry';
import { endSeries, firstAttempt, findLive, openDueSeries, pressSeries, runDue, seriesView, settleSeriesByHand, type SeriesContext } from './refund-series-steps';
import type { RefundSeriesKey, RefundSeriesRow, RefundRetryStore } from './refund-series-store';
import type { RefundInput } from './refund-input';
import type { ChargeSnapshot, MerchantRef, RefundSnapshot } from './types';

/**
 * A store refund that a provider could not take yet, retried in the background
 * (FUT-4740). Attempt 1 is sent by the host's request (`firstAttempt`, the ONE
 * place it is sent); a "not yet" opens a series of 3 (T0, +5 min, +15 min), no
 * answer a series of 4 (T0, +30 s, +5 min, +15 min); every later attempt is
 * CLAIMED behind the series row's version, consults the charge, and only then
 * sends ONE cancel. A refusal for good, or the last attempt, leaves a pending
 * refund a person settles: "Tentar estornar de novo" (`press`, a new series),
 * or a hand act (`settleByHand`). The error tracker hears once per series.
 *
 * The host binds three things and nothing more: whether the money is still
 * owed through this series (`stillOwed`), what a failed attempt writes
 * (`attempted`) and what a refund writes (`refunded`).
 */

/** The gateway calls a retrier makes. */
export interface RefundRetrierGateway {
  refund(merchant: MerchantRef, provider: string, input: RefundInput): Promise<RefundSnapshot>;
  refreshCharge(
    merchant: MerchantRef,
    provider: string,
    providerChargeId: string,
    hints?: undefined,
    options?: { signal?: AbortSignal },
  ): Promise<Pick<ChargeSnapshot, 'status'> & Partial<ChargeSnapshot>>;
}

/** The host's half: its predicate and its two writes. */
export interface RefundRetrierHost {
  /** Is the money still owed through this series (I2)? False ends it with nothing sent. */
  stillOwed(row: RefundSeriesRow): Promise<boolean>;
  /** An attempt that did not refund: its trail entry. */
  attempted(row: RefundSeriesRow, refusal: RefundRefusal, error: unknown): Promise<void>;
  /** The money went back (a refund, or one adopted): ALWAYS recorded, whatever `stillOwed` says now (I11). */
  refunded(row: RefundSeriesRow, outcome: { snapshot: RefundSnapshot | null; adopted: boolean }): Promise<void>;
}

export interface RefundRetrierDeps {
  gateway: RefundRetrierGateway;
  store: RefundRetryStore;
  host: RefundRetrierHost;
  now?: () => Date;
  /** The provider deadline of one attempt; the default is `REFUND_ATTEMPT_DEADLINE_MS` (90 s). */
  attemptMs?: number;
  onProviderFailure?: ProviderFailureReporter;
}

/** What attempt 1 came to. */
export type FirstAttemptResult =
  /** The provider answered with a refund snapshot (its `status` says whether it took). */
  | { kind: 'REFUNDED'; snapshot: RefundSnapshot }
  /** The charge had nothing left to refund: the money is already back. */
  | { kind: 'ADOPTED' }
  /** A refusal for good: no series; the host releases its claim. */
  | { kind: 'REFUSED'; error: unknown }
  /** "Not yet" or no answer: a series is open, attempt 2 is due. */
  | { kind: 'NOT_YET' | 'UNKNOWN'; error: unknown; row: RefundSeriesRow | null };

/** The series as a screen shows it. */
export interface RefundSeriesView {
  series: number;
  attempt: number;
  of: number;
  /** The next automatic attempt; null while one runs or when none will. */
  nextAt: string | null;
  exhausted: boolean;
  refusal: RefundRefusal | null;
  /** An attempt holds its claim now: no person's act may run (C27). */
  inFlight: boolean;
}

export interface RefundRetrier {
  firstAttempt(key: RefundSeriesKey, input?: Partial<Pick<RefundInput, 'reason'>>): Promise<FirstAttemptResult>;
  /** The sweep: run the attempts that are due. Answers how many were looked at. */
  runDue(limit?: number): Promise<number>;
  /** "Tentar estornar de novo": a new series, attempt 1 now with a consult; a no-op while one runs. */
  press(key: RefundSeriesKey): Promise<RefundSeriesView | null>;
  /** A series whose attempt 1 is due now, for the sweep (a refund held before the retry existed); false when the charge has one. */
  openDue(key: RefundSeriesKey): Promise<boolean>;
  /** A person settled it: false while an attempt is in flight (the act must wait). */
  settleByHand(key: RefundSeriesKey): Promise<boolean>;
  /** The pedido moved on (an undo): the series ends, whatever runs. */
  end(key: RefundSeriesKey): Promise<void>;
  /** The live (unsettled) series of this key, or null. */
  find(key: RefundSeriesKey): Promise<RefundSeriesRow | null>;
  viewOf(row: RefundSeriesRow | null): RefundSeriesView | null;
}

export function createRefundRetrier(deps: RefundRetrierDeps): RefundRetrier {
  const ctx: SeriesContext = { ...deps, clock: deps.now ?? (() => new Date()) };
  return {
    firstAttempt: (key, input) => firstAttempt(ctx, key, input),
    runDue: (limit) => runDue(ctx, limit),
    press: (key) => pressSeries(ctx, key),
    openDue: (key) => openDueSeries(ctx, key),
    settleByHand: (key) => settleSeriesByHand(ctx, key),
    end: (key) => endSeries(ctx, key),
    find: (key) => findLive(ctx, key),
    viewOf: (row) => seriesView(ctx, row),
  };
}
