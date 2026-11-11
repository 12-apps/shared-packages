import { reportProviderFailure, isProviderEndpointFailure, type ProviderFailureReporter } from './provider-failure';
import {
  afterRefusal,
  claimHeld,
  firstClaim,
  isNothingToRefund,
  nextClaim,
  REFUND_ATTEMPT_DEADLINE_MS,
  REFUND_CLAIM_TTL_MS,
  refundDueNow,
  refundRefusalOf,
  attemptsOf,
  type RefundRefusal,
  type RefundRetryState,
} from './refund-retry';
import type { RefundSeriesKey, RefundSeriesRow, RefundSeriesSettlement, RefundRetryStore } from './refund-series-store';
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
  /** The provider deadline of one attempt; the default is {@link REFUND_ATTEMPT_DEADLINE_MS}. */
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
  /** A person settled it: false while an attempt is in flight (the act must wait). */
  settleByHand(key: RefundSeriesKey): Promise<boolean>;
  /** The pedido moved on (an undo): the series ends, whatever runs. */
  end(key: RefundSeriesKey): Promise<void>;
  /** The live (unsettled) series of this key, or null. */
  find(key: RefundSeriesKey): Promise<RefundSeriesRow | null>;
  viewOf(row: RefundSeriesRow | null): RefundSeriesView | null;
}

const SWEEP_BATCH = 5;

/** The fields of a fresh series on `key`. */
function rowFields(key: RefundSeriesKey) {
  return {
    merchant: key.merchant,
    provider: key.provider,
    providerChargeId: key.providerChargeId,
    reference: key.reference,
    subject: key.subject,
    boundTo: key.boundTo,
    amountCents: key.amountCents ?? null,
    cause: key.cause ?? null,
    settledAt: null,
    settledHow: null,
  };
}

const live = (row: RefundSeriesRow | null, key: RefundSeriesKey): row is RefundSeriesRow =>
  row !== null && row.settledAt === null && row.boundTo === key.boundTo;

/** What the store keeps of a state: the state's fields over the row. */
const withState = (row: RefundSeriesRow, state: RefundRetryState): RefundSeriesRow => ({ ...row, ...state, of: state.of });

export function createRefundRetrier(deps: RefundRetrierDeps): RefundRetrier {
  const clock = deps.now ?? (() => new Date());
  const { store, host, gateway } = deps;

  const signal = () => AbortSignal.timeout(deps.attemptMs ?? REFUND_ATTEMPT_DEADLINE_MS);
  const refundInput = (row: Pick<RefundSeriesRow, 'providerChargeId' | 'amountCents'>, reason?: string): RefundInput => ({
    providerChargeId: row.providerChargeId,
    ...(row.amountCents !== null ? { amount: { amountCents: row.amountCents, currency: 'BRL' } } : {}),
    ...(reason ? { reason } : {}),
    retriedByCaller: true,
    signal: signal(),
  });

  function report(row: Pick<RefundSeriesRow, 'merchant' | 'provider' | 'reference'>, refusal: RefundRefusal, error: unknown): void {
    reportProviderFailure(deps.onProviderFailure, {
      path: 'REFUND',
      // A refusal for good is a fault; a "not yet" or no verdict that ran out of attempts is news.
      severity: refusal === 'REFUSED' ? 'error' : 'warning',
      merchant: row.merchant,
      provider: row.provider,
      reference: row.reference,
      error: error ?? undefined,
      message: `refund ${refusal === 'REFUSED' ? 'refused' : 'not taken'} after its attempts`,
    });
  }

  /** Settle a series behind the version it was read at; answers the stored row or null. */
  const settle = (row: RefundSeriesRow, how: RefundSeriesSettlement) =>
    store.saveIf({ ...row, settledAt: clock().toISOString(), settledHow: how, claimedAt: null, nextAt: null }, row.version);

  /** Open (or re-open, for a new cancel) the series of `key` in `state`. */
  async function open(key: RefundSeriesKey, state: RefundRetryState): Promise<RefundSeriesRow | null> {
    const stored = await store.find(key.provider, key.providerChargeId, key.subject);
    if (!stored) return store.insert({ ...rowFields(key), ...state, of: state.of });
    return store.saveIf({ ...stored, ...rowFields(key), ...state, of: state.of }, stored.version);
  }

  async function firstAttempt(key: RefundSeriesKey, input: Partial<Pick<RefundInput, 'reason'>> = {}): Promise<FirstAttemptResult> {
    let snapshot: RefundSnapshot;
    try {
      snapshot = await gateway.refund(key.merchant, key.provider, refundInput({ providerChargeId: key.providerChargeId, amountCents: key.amountCents ?? null }, input.reason));
    } catch (error) {
      if (isNothingToRefund(error)) return { kind: 'ADOPTED' };
      // Decided before anything was sent (not connected, no refund capability): the host's taxonomy.
      if (!isProviderEndpointFailure(error)) throw error;
      const refusal = refundRefusalOf(error);
      if (refusal === 'REFUSED') {
        report({ merchant: key.merchant, provider: key.provider, reference: key.reference }, refusal, error);
        return { kind: 'REFUSED', error };
      }
      const now = clock();
      const state = afterRefusal({ ...firstClaim(now, null), reported: false }, refusal, now);
      const row = await open(key, state);
      if (row) await host.attempted(row, refusal, error);
      return { kind: refusal, error, row };
    }
    return { kind: 'REFUNDED', snapshot };
  }

  /** The money is back without a cancel of ours: recorded, then the series settled. */
  async function adopt(row: RefundSeriesRow, snapshot: RefundSnapshot | null): Promise<void> {
    await host.refunded(row, { snapshot, adopted: true });
    await settle(row, 'ADOPTED');
  }

  /** Read the charge; true when its money is already back. A consult that fails decides nothing. */
  async function alreadyBack(row: RefundSeriesRow): Promise<boolean> {
    try {
      const charge = await gateway.refreshCharge(row.merchant, row.provider, row.providerChargeId, undefined, { signal: signal() });
      return charge.status === 'REFUNDED' || (row.amountCents === null && charge.status === 'CANCELED');
    } catch {
      return false;
    }
  }

  /** Write a refused attempt's state behind its claim; report a give-up once per series. */
  async function refusedAttempt(claimed: RefundSeriesRow, refusal: RefundRefusal, error: unknown): Promise<void> {
    const next = afterRefusal(claimed, refusal, clock());
    const reportNow = next.exhausted && !next.reported;
    const saved = await store.saveIf(withState(claimed, reportNow ? { ...next, reported: true } : next), claimed.version);
    if (!saved) return;
    await host.attempted(saved, refusal, error);
    if (reportNow) report(saved, refusal, error);
  }

  /** ONE claimed attempt: consult, then one cancel; its answer written behind the claim. */
  async function attempt(claimed: RefundSeriesRow): Promise<void> {
    if (!(await host.stillOwed(claimed))) {
      await settle(claimed, 'ENDED');
      return;
    }
    if (await alreadyBack(claimed)) return adopt(claimed, null);
    let snapshot: RefundSnapshot;
    try {
      snapshot = await gateway.refund(claimed.merchant, claimed.provider, refundInput(claimed));
    } catch (error) {
      if (isNothingToRefund(error)) return adopt(claimed, null);
      return refusedAttempt(claimed, isProviderEndpointFailure(error) ? refundRefusalOf(error) : 'UNKNOWN', error);
    }
    // The provider answered that the cancel did not take: an answer, waiting changes nothing.
    if (snapshot.status === 'FAILED') return refusedAttempt(claimed, 'REFUSED', null);
    await host.refunded(claimed, { snapshot, adopted: false });
    await settle(claimed, 'REFUNDED');
  }

  /** A dead claimant held the LAST attempt: consult only, adopt or give up. */
  async function close(claimed: RefundSeriesRow): Promise<void> {
    if (!(await host.stillOwed(claimed))) {
      await settle(claimed, 'ENDED');
      return;
    }
    if (await alreadyBack(claimed)) return adopt(claimed, null);
    const refusal = claimed.refusal ?? 'UNKNOWN';
    const reportNow = !claimed.reported;
    const saved = await store.saveIf(
      { ...claimed, refusal, exhausted: true, nextAt: null, claimedAt: null, reported: true },
      claimed.version,
    );
    if (saved && reportNow) report(saved, refusal, null);
  }

  /** Claim `state` behind the row's version; the claim's expiry is its `nextAt`, so the sweep finds a dead one. */
  function claim(row: RefundSeriesRow, state: RefundRetryState, now: Date): Promise<RefundSeriesRow | null> {
    const expiry = new Date(now.getTime() + REFUND_CLAIM_TTL_MS).toISOString();
    return store.saveIf(withState(row, { ...state, nextAt: expiry }), row.version);
  }

  async function runRow(row: RefundSeriesRow): Promise<void> {
    const now = clock();
    const due = refundDueNow(row, now);
    if (due === null) return;
    const claimed = await claim(row, due === 'CLOSE' ? { ...row, claimedAt: now.toISOString() } : nextClaim(now, row), now);
    if (!claimed) return;
    if (due === 'CLOSE') return close(claimed);
    return attempt(claimed);
  }

  async function runDue(limit = SWEEP_BATCH): Promise<number> {
    const rows = await store.due(clock(), limit);
    for (const row of rows) await runRow(row);
    return rows.length;
  }

  async function find(key: RefundSeriesKey): Promise<RefundSeriesRow | null> {
    const row = await store.find(key.provider, key.providerChargeId, key.subject);
    return live(row, key) ? row : null;
  }

  function viewOf(row: RefundSeriesRow | null): RefundSeriesView | null {
    if (!row || row.settledAt !== null) return null;
    const inFlight = claimHeld(row, clock());
    return {
      series: row.series,
      attempt: row.attempt,
      of: attemptsOf(row),
      nextAt: inFlight ? null : row.nextAt,
      exhausted: row.exhausted,
      refusal: row.refusal,
      inFlight,
    };
  }

  async function press(key: RefundSeriesKey): Promise<RefundSeriesView | null> {
    const stored = await store.find(key.provider, key.providerChargeId, key.subject);
    const current = live(stored, key) ? stored : null;
    // Settled for THIS cancel (refunded, adopted, by hand): nothing is owed through it.
    if (stored && !current && stored.boundTo === key.boundTo) return null;
    // A series still running (or an attempt in flight): the press answers it, never a second one.
    if (current && (!current.exhausted || claimHeld(current, clock()))) return viewOf(current);
    const now = clock();
    const state: RefundRetryState = { ...firstClaim(now, current), reported: false };
    const expiry = new Date(now.getTime() + REFUND_CLAIM_TTL_MS).toISOString();
    const claimed = stored
      ? await store.saveIf({ ...stored, ...rowFields(key), ...state, of: undefined, nextAt: expiry }, stored.version)
      : await store.insert({ ...rowFields(key), ...state, nextAt: expiry });
    if (!claimed) return viewOf(await find(key));
    await attempt(claimed);
    return viewOf(await find(key));
  }

  async function settleByHand(key: RefundSeriesKey): Promise<boolean> {
    const row = await find(key);
    if (!row) return true;
    if (claimHeld(row, clock())) return false;
    return (await settle(row, 'BY_HAND')) !== null;
  }

  async function end(key: RefundSeriesKey): Promise<void> {
    for (let tries = 0; tries < 3; tries += 1) {
      const row = await find(key);
      if (!row || (await settle(row, 'ENDED'))) return;
    }
  }

  return { firstAttempt, runDue, press, settleByHand, end, find, viewOf };
}

