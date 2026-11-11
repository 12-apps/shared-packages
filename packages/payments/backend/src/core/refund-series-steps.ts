import { isProviderEndpointFailure, reportProviderFailure } from './provider-failure';
import {
  afterRefusal,
  attemptsOf,
  claimHeld,
  firstClaim,
  isNothingToRefund,
  nextClaim,
  REFUND_ATTEMPT_DEADLINE_MS,
  REFUND_CLAIM_TTL_MS,
  refundDueNow,
  refundRefusalOf,
  type RefundRefusal,
  type RefundRetryState,
} from './refund-retry';
import type { FirstAttemptResult, RefundRetrierDeps, RefundSeriesView } from './refund-series';
import type { RefundSeriesKey, RefundSeriesRow, RefundSeriesSettlement } from './refund-series-store';
import type { RefundInput } from './refund-input';
import type { RefundSnapshot } from './types';

/**
 * The store refund retrier's steps (FUT-4740), one function each over the
 * retrier's context; `refund-series.ts` holds the contract and binds them.
 */

export interface SeriesContext extends RefundRetrierDeps {
  clock: () => Date;
}

const SWEEP_BATCH = 5;

const deadline = (ctx: SeriesContext) => AbortSignal.timeout(ctx.attemptMs ?? REFUND_ATTEMPT_DEADLINE_MS);
const claimExpiry = (now: Date) => new Date(now.getTime() + REFUND_CLAIM_TTL_MS).toISOString();

function refundInput(ctx: SeriesContext, row: Pick<RefundSeriesRow, 'providerChargeId' | 'amountCents'>, reason?: string): RefundInput {
  return {
    providerChargeId: row.providerChargeId,
    ...(row.amountCents !== null ? { amount: { amountCents: row.amountCents, currency: 'BRL' } } : {}),
    ...(reason ? { reason } : {}),
    retriedByCaller: true,
    signal: deadline(ctx),
  };
}

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

/** The error tracker hears of a series that gave up, once per series (I10). */
function report(ctx: SeriesContext, row: Pick<RefundSeriesRow, 'merchant' | 'provider' | 'reference'>, refusal: RefundRefusal, error: unknown): void {
  reportProviderFailure(ctx.onProviderFailure, {
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
function settle(ctx: SeriesContext, row: RefundSeriesRow, how: RefundSeriesSettlement) {
  return ctx.store.saveIf({ ...row, settledAt: ctx.clock().toISOString(), settledHow: how, claimedAt: null, nextAt: null }, row.version);
}

/** Open (or re-open, for a new cancel) the series of `key` in `state`. */
async function open(ctx: SeriesContext, key: RefundSeriesKey, state: RefundRetryState): Promise<RefundSeriesRow | null> {
  // Insert first: a charge's first series is one write (the host's query budget); only a re-cancel finds a row.
  const inserted = await ctx.store.insert({ ...rowFields(key), ...state, of: state.of });
  if (inserted) return inserted;
  const stored = await ctx.store.find(key.provider, key.providerChargeId, key.subject);
  return stored ? ctx.store.saveIf({ ...stored, ...rowFields(key), ...state, of: state.of }, stored.version) : null;
}

/** A refusal of attempt 1: none for good opens a series; "not yet" and no answer do (I4). */
async function firstRefusal(ctx: SeriesContext, key: RefundSeriesKey, error: unknown): Promise<FirstAttemptResult> {
  const refusal = refundRefusalOf(error);
  if (refusal === 'REFUSED') {
    report(ctx, key, refusal, error);
    return { kind: 'REFUSED', error };
  }
  const now = ctx.clock();
  const row = await open(ctx, key, afterRefusal({ ...firstClaim(now, null), reported: false }, refusal, now));
  if (row) await ctx.host.attempted(row, refusal, error);
  return { kind: refusal, error, row };
}

/** Attempt 1, from the host's request: the ONE place it is sent. */
export async function firstAttempt(
  ctx: SeriesContext,
  key: RefundSeriesKey,
  input: Partial<Pick<RefundInput, 'reason'>> = {},
): Promise<FirstAttemptResult> {
  try {
    const target = { providerChargeId: key.providerChargeId, amountCents: key.amountCents ?? null };
    const snapshot = await ctx.gateway.refund(key.merchant, key.provider, refundInput(ctx, target, input.reason));
    return { kind: 'REFUNDED', snapshot };
  } catch (error) {
    if (isNothingToRefund(error)) return { kind: 'ADOPTED' };
    // Decided before anything was sent (not connected, no refund capability): the host's taxonomy.
    if (!isProviderEndpointFailure(error)) throw error;
    return firstRefusal(ctx, key, error);
  }
}

/** The money is back without a cancel of ours: recorded, then the series settled. */
async function adopt(ctx: SeriesContext, row: RefundSeriesRow): Promise<void> {
  await ctx.host.refunded(row, { snapshot: null, adopted: true });
  await settle(ctx, row, 'ADOPTED');
}

/** Read the charge; true when its money is already back. A consult that fails decides nothing. */
async function alreadyBack(ctx: SeriesContext, row: RefundSeriesRow): Promise<boolean> {
  try {
    const charge = await ctx.gateway.refreshCharge(row.merchant, row.provider, row.providerChargeId, undefined, { signal: deadline(ctx) });
    return charge.status === 'REFUNDED' || (row.amountCents === null && charge.status === 'CANCELED');
  } catch {
    return false;
  }
}

/** Write a refused attempt's state behind its claim; report a give-up once per series. */
async function refusedAttempt(ctx: SeriesContext, claimed: RefundSeriesRow, refusal: RefundRefusal, error: unknown): Promise<void> {
  const next = afterRefusal(claimed, refusal, ctx.clock());
  const reportNow = next.exhausted && !next.reported;
  const saved = await ctx.store.saveIf(withState(claimed, reportNow ? { ...next, reported: true } : next), claimed.version);
  if (!saved) return;
  await ctx.host.attempted(saved, refusal, error);
  if (reportNow) report(ctx, saved, refusal, error);
}

/** Send the claimed attempt's ONE cancel and write its answer. */
async function sendOne(ctx: SeriesContext, claimed: RefundSeriesRow): Promise<void> {
  let snapshot: RefundSnapshot;
  try {
    snapshot = await ctx.gateway.refund(claimed.merchant, claimed.provider, refundInput(ctx, claimed));
  } catch (error) {
    if (isNothingToRefund(error)) return adopt(ctx, claimed);
    return refusedAttempt(ctx, claimed, isProviderEndpointFailure(error) ? refundRefusalOf(error) : 'UNKNOWN', error);
  }
  // The provider answered that the cancel did not take: an answer, waiting changes nothing.
  if (snapshot.status === 'FAILED') return refusedAttempt(ctx, claimed, 'REFUSED', null);
  await ctx.host.refunded(claimed, { snapshot, adopted: false });
  await settle(ctx, claimed, 'REFUNDED');
}

/** ONE claimed attempt: still owed? consult, then one cancel (I2, I3). */
async function attempt(ctx: SeriesContext, claimed: RefundSeriesRow): Promise<void> {
  if (!(await ctx.host.stillOwed(claimed))) {
    await settle(ctx, claimed, 'ENDED');
    return;
  }
  if (await alreadyBack(ctx, claimed)) return adopt(ctx, claimed);
  return sendOne(ctx, claimed);
}

/** A dead claimant held the LAST attempt: consult only, adopt or give up. */
async function close(ctx: SeriesContext, claimed: RefundSeriesRow): Promise<void> {
  if (!(await ctx.host.stillOwed(claimed))) {
    await settle(ctx, claimed, 'ENDED');
    return;
  }
  if (await alreadyBack(ctx, claimed)) return adopt(ctx, claimed);
  const refusal = claimed.refusal ?? 'UNKNOWN';
  const saved = await ctx.store.saveIf(
    { ...claimed, refusal, exhausted: true, nextAt: null, claimedAt: null, reported: true },
    claimed.version,
  );
  if (saved && !claimed.reported) report(ctx, saved, refusal, null);
}

async function runRow(ctx: SeriesContext, row: RefundSeriesRow): Promise<void> {
  const now = ctx.clock();
  const due = refundDueNow(row, now);
  if (due === null) return;
  const state = due === 'CLOSE' ? { ...row, claimedAt: now.toISOString() } : nextClaim(now, row);
  // The claim's expiry is its `nextAt`, so the sweep finds a dead claimant.
  const claimed = await ctx.store.saveIf(withState(row, { ...state, nextAt: claimExpiry(now) }), row.version);
  if (!claimed) return;
  return due === 'CLOSE' ? close(ctx, claimed) : attempt(ctx, claimed);
}

/** The sweep: run the attempts that are due. Answers how many were looked at. */
export async function runDue(ctx: SeriesContext, limit = SWEEP_BATCH): Promise<number> {
  const rows = await ctx.store.due(ctx.clock(), limit);
  for (const row of rows) await runRow(ctx, row);
  return rows.length;
}

export async function findLive(ctx: SeriesContext, key: RefundSeriesKey): Promise<RefundSeriesRow | null> {
  const row = await ctx.store.find(key.provider, key.providerChargeId, key.subject);
  return live(row, key) ? row : null;
}

export function seriesView(ctx: SeriesContext, row: RefundSeriesRow | null): RefundSeriesView | null {
  if (!row || row.settledAt !== null) return null;
  const inFlight = claimHeld(row, ctx.clock());
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

/** Claim a NEW series' attempt 1 behind the stored row (or as its insert). */
function claimNewSeries(ctx: SeriesContext, key: RefundSeriesKey, stored: RefundSeriesRow | null, current: RefundSeriesRow | null) {
  const now = ctx.clock();
  const state: RefundRetryState = { ...firstClaim(now, current), reported: false, nextAt: claimExpiry(now) };
  return stored
    ? ctx.store.saveIf({ ...stored, ...rowFields(key), ...state, of: undefined }, stored.version)
    : ctx.store.insert({ ...rowFields(key), ...state });
}

/** "Tentar estornar de novo": a new series, attempt 1 now with a consult; a no-op while one runs (C21, C22). */
export async function pressSeries(ctx: SeriesContext, key: RefundSeriesKey): Promise<RefundSeriesView | null> {
  const stored = await ctx.store.find(key.provider, key.providerChargeId, key.subject);
  const current = live(stored, key) ? stored : null;
  // Settled for THIS cancel (refunded, adopted, by hand): nothing is owed through it.
  if (stored && !current && stored.boundTo === key.boundTo) return null;
  // A series still running (or an attempt in flight): the press answers it, never a second one.
  if (current && (!current.exhausted || claimHeld(current, ctx.clock()))) return seriesView(ctx, current);
  const claimed = await claimNewSeries(ctx, key, stored, current);
  if (claimed) await attempt(ctx, claimed);
  return seriesView(ctx, await findLive(ctx, key));
}

/** A person settled it: false while an attempt is in flight (C27). */
export async function settleSeriesByHand(ctx: SeriesContext, key: RefundSeriesKey): Promise<boolean> {
  const row = await findLive(ctx, key);
  if (!row) return true;
  if (claimHeld(row, ctx.clock())) return false;
  return (await settle(ctx, row, 'BY_HAND')) !== null;
}

/** The pedido moved on (an undo): the series ends, whatever runs (C29). */
export async function endSeries(ctx: SeriesContext, key: RefundSeriesKey): Promise<void> {
  for (let tries = 0; tries < 3; tries += 1) {
    const row = await findLive(ctx, key);
    if (!row || (await settle(ctx, row, 'ENDED'))) return;
  }
}
