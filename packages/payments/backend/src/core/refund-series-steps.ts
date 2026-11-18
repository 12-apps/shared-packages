import { isRequestTimeout } from './failover';
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
import { baselineFor, baselineOf, blockersOf, deferredUntil, isPart, owedCents, pressSiblings, siblingsOf } from './refund-series-part';
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

/**
 * Attempts per sweep tick. Each is bounded by ONE deadline (90 s) shared by its
 * consult and its cancel, so two fit inside the sweep's 5-minute lease with
 * room to spare (FUT-4740 review B1); the next tick takes the rest.
 */
const SWEEP_BATCH = 2;

/** ONE attempt's deadline, created once and handed to every provider call of that attempt (B1). */
const deadline = (ctx: SeriesContext) => AbortSignal.timeout(ctx.attemptMs ?? REFUND_ATTEMPT_DEADLINE_MS);

/**
 * A failure the provider may have answered, or not: its own error, a transport
 * failure, or our deadline firing on the request (an `AbortError` /
 * `TimeoutError`, review N2) — never a refusal decided before dispatch.
 */
const endpointFailure = (error: unknown): boolean => isProviderEndpointFailure(error) || isRequestTimeout(error);

const claimExpiry = (now: Date) => new Date(now.getTime() + REFUND_CLAIM_TTL_MS).toISOString();

function refundInput(row: Pick<RefundSeriesRow, 'providerChargeId' | 'amountCents'>, signal: AbortSignal, reason?: string, cents = row.amountCents): RefundInput {
  return {
    providerChargeId: row.providerChargeId,
    ...(cents !== null ? { amount: { amountCents: cents, currency: 'BRL' } } : {}),
    ...(reason ? { reason } : {}),
    retriedByCaller: true,
    signal,
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
  return stored ? ctx.store.saveIf({ ...stored, ...rowFields(key), ...state, of: state.of, ...baselineFor(stored, key) }, stored.version) : null;
}

/** A refusal of attempt 1: none for good opens a series; "not yet" and no answer do (I4). */
async function firstRefusal(ctx: SeriesContext, key: RefundSeriesKey, error: unknown): Promise<FirstAttemptResult> {
  const refusal = isRequestTimeout(error) ? 'UNKNOWN' : refundRefusalOf(error);
  if (refusal === 'REFUSED') {
    report(ctx, key, refusal, error);
    return { kind: 'REFUSED', error };
  }
  // No answer on a PART: nothing can tell later whether it went back, so no series opens (B2).
  if (refusal === 'UNKNOWN' && (key.amountCents ?? null) !== null) {
    report(ctx, key, refusal, error);
    return { kind: 'UNKNOWN', error, row: null };
  }
  const now = ctx.clock();
  const row = await open(ctx, key, afterRefusal({ ...firstClaim(now, null), reported: false }, refusal, now));
  if (row) await ctx.host.attempted(row, refusal, error);
  return { kind: refusal, error, row };
}

/**
 * Attempt 1 the provider ANSWERED with a FAILED refund (FUT-612): nothing went
 * back, and the answer does not say whether a later one would take. Read as no
 * answer, so the series opens on the no-answer schedule — every later attempt
 * consults the charge first, and a refund that landed after all is adopted —
 * and the trail is written, as for any refusal of attempt 1.
 */
export function firstFailedAnswer(ctx: SeriesContext, key: RefundSeriesKey): Promise<FirstAttemptResult> {
  return firstRefusal(ctx, key, new Error(`the provider answered the refund of ${key.providerChargeId} FAILED`));
}

/** Attempt 1, from the host's request: the ONE place it is sent. */
export async function firstAttempt(
  ctx: SeriesContext,
  key: RefundSeriesKey,
  input: Partial<Pick<RefundInput, 'reason'>> = {},
): Promise<FirstAttemptResult> {
  try {
    const target = { providerChargeId: key.providerChargeId, amountCents: key.amountCents ?? null };
    const snapshot = await ctx.gateway.refund(key.merchant, key.provider, refundInput(target, deadline(ctx), input.reason));
    return { kind: 'REFUNDED', snapshot };
  } catch (error) {
    if (isNothingToRefund(error)) return { kind: 'ADOPTED', refundedCents: await consultedCents(ctx, key) };
    // Decided before anything was sent (not connected, no refund capability): the host's taxonomy.
    if (!endpointFailure(error)) throw error;
    return firstRefusal(ctx, key, error);
  }
}

/** The money is back without a cancel of ours: recorded with what the consult saw, then the series settled (S6). */
async function adopt(ctx: SeriesContext, row: RefundSeriesRow, refundedCents: number | null): Promise<void> {
  await ctx.host.refunded(row, { snapshot: null, adopted: true, refundedCents });
  await settle(ctx, row, 'ADOPTED');
}

/** What a consult says of the charge: its money back (with the amount it shows), still owed, or no answer. */
type Consulted = { kind: 'BACK'; refundedCents: number | null } | { kind: 'OWED'; readBack: number | null } | { kind: 'UNKNOWN'; error: unknown };

/**
 * Read the charge under the attempt's deadline. A whole charge REFUNDED or
 * CANCELED went back; a part is proven back only by a charge refunded whole.
 * A consult that fails is NOT "send": it is "do not know" (review B2).
 */
async function consult(ctx: SeriesContext, row: Pick<RefundSeriesRow, 'merchant' | 'provider' | 'providerChargeId' | 'amountCents'>, signal: AbortSignal): Promise<Consulted> {
  try {
    const charge = await ctx.gateway.refreshCharge(row.merchant, row.provider, row.providerChargeId, undefined, { signal });
    const back = charge.status === 'REFUNDED' || (row.amountCents === null && charge.status === 'CANCELED');
    if (back) return { kind: 'BACK', refundedCents: row.amountCents ?? charge.amount?.amountCents ?? null };
    // The provider's refunded total, when its adapter reads it back (FUT-4951); null: it cannot say.
    return { kind: 'OWED', readBack: charge.refundedAmount?.amountCents ?? null };
  } catch (error) {
    return { kind: 'UNKNOWN', error };
  }
}

/** The amount a charge shows refunded, for an adoption attempt 1 met (best effort: null when the read fails). */
async function consultedCents(ctx: SeriesContext, key: RefundSeriesKey): Promise<number | null> {
  const seen = await consult(ctx, { ...key, amountCents: key.amountCents ?? null }, deadline(ctx));
  return seen.kind === 'BACK' ? seen.refundedCents : (key.amountCents ?? null);
}

/**
 * Write a refused attempt's state behind its claim; report a give-up once per series. `pending`
 * ends the series for a person: a part sent with no read-back that got no answer is never sent
 * again blind (B2); one with a baseline stays on the schedule, read back first (FUT-4951).
 */
async function refusedAttempt(ctx: SeriesContext, claimed: RefundSeriesRow, refusal: RefundRefusal, error: unknown, pending = false): Promise<void> {
  const after = afterRefusal(claimed, refusal, ctx.clock());
  const next = pending ? { ...after, nextAt: null, exhausted: true } : after;
  const reportNow = next.exhausted && !next.reported;
  const saved = await ctx.store.saveIf(withState(claimed, reportNow ? { ...next, reported: true } : next), claimed.version);
  if (!saved) return;
  await ctx.host.attempted(saved, refusal, error);
  if (reportNow) report(ctx, saved, refusal, error);
}

/** A part sent with no baseline: nothing can prove later whether it went back (B2). */
const blindPart = (row: RefundSeriesRow): boolean => isPart(row) && baselineOf(row) === null;

/** The cancel threw: adopted when nothing was left to refund, else a refusal (a blind part's no answer is final). */
function sendFailed(ctx: SeriesContext, claimed: RefundSeriesRow, error: unknown): Promise<void> {
  if (isNothingToRefund(error)) return adopt(ctx, claimed, claimed.amountCents);
  const refusal = isRequestTimeout(error) || !isProviderEndpointFailure(error) ? 'UNKNOWN' : refundRefusalOf(error);
  return refusedAttempt(ctx, claimed, refusal, error, refusal === 'UNKNOWN' && blindPart(claimed));
}

/** The provider answered FAILED: a part read back takes it as no answer (read back next time); otherwise final. */
function answeredFailed(ctx: SeriesContext, claimed: RefundSeriesRow): Promise<void> {
  if (!isPart(claimed) || blindPart(claimed)) return refusedAttempt(ctx, claimed, 'REFUSED', null);
  return refusedAttempt(ctx, claimed, 'UNKNOWN', new Error(`the provider answered the refund of ${claimed.providerChargeId} FAILED`));
}

/**
 * Send the claimed attempt's ONE cancel (`cents`: what a part still owes) and write its answer. A
 * part read back (a baseline is set) takes no answer and FAILED alike as "not known": the next
 * attempt reads back first, so asking again is safe (FUT-4951).
 */
async function sendOne(ctx: SeriesContext, claimed: RefundSeriesRow, signal: AbortSignal, cents = claimed.amountCents): Promise<void> {
  // The deadline already fired during the consult: nothing is sent past it (B1).
  if (signal.aborted) return refusedAttempt(ctx, claimed, 'UNKNOWN', signal.reason);
  let snapshot: RefundSnapshot;
  try {
    snapshot = await ctx.gateway.refund(claimed.merchant, claimed.provider, refundInput(claimed, signal, undefined, cents));
  } catch (error) {
    return sendFailed(ctx, claimed, error);
  }
  if (snapshot.status === 'FAILED') return answeredFailed(ctx, claimed);
  // A part: what went back THROUGH this series is the part, whether this send asked all of it or the rest.
  await ctx.host.refunded(claimed, { snapshot, adopted: false, ...(isPart(claimed) ? { refundedCents: claimed.amountCents } : {}) });
  await settle(ctx, claimed, 'REFUNDED');
}

/**
 * A part's attempt after its consult (FUT-4951): with no read-back, B2 (sent once; a later attempt
 * gives up); else the baseline is written before the first send, and every later attempt sends only
 * what the read-back proves is still owed, or adopts the part when nothing is.
 */
async function sendPart(ctx: SeriesContext, claimed: RefundSeriesRow, signal: AbortSignal, readBack: number | null, siblings: readonly RefundSeriesRow[]): Promise<void> {
  const baseline = baselineOf(claimed);
  if (readBack === null) {
    if (baseline === null) return sendOne(ctx, claimed, signal);
    return refusedAttempt(ctx, claimed, 'UNKNOWN', new Error('the provider did not read the refunded total back'), true);
  }
  if (baseline === null) {
    const based = await ctx.store.saveIf({ ...claimed, refundedBeforeCents: readBack, refundedBeforeAt: ctx.clock().toISOString() }, claimed.version);
    return based ? sendOne(ctx, based, signal) : undefined;
  }
  const owed = owedCents(claimed, readBack, siblings);
  if (owed <= 0) return adopt(ctx, claimed, claimed.amountCents);
  return sendOne(ctx, claimed, signal, owed);
}

/** ONE claimed attempt: still owed? consult, then one cancel (I2, I3); a part's siblings for its owed sum. */
async function attempt(ctx: SeriesContext, claimed: RefundSeriesRow, siblings: readonly RefundSeriesRow[] = []): Promise<void> {
  if (!(await ctx.host.stillOwed(claimed))) {
    await settle(ctx, claimed, 'ENDED');
    return;
  }
  // ONE deadline for the consult and the cancel together: the attempt is over before its claim expires (B1).
  const signal = deadline(ctx);
  const seen = await consult(ctx, claimed, signal);
  if (seen.kind === 'BACK') return adopt(ctx, claimed, seen.refundedCents);
  // A blind part past its first attempt may have been sent by a claimant that died: never resent unread (B2).
  if (seen.kind === 'UNKNOWN') return refusedAttempt(ctx, claimed, 'UNKNOWN', seen.error, blindPart(claimed) && claimed.attempt > 1);
  if (isPart(claimed)) return sendPart(ctx, claimed, signal, seen.readBack, siblings);
  return sendOne(ctx, claimed, signal);
}

/** A part read back whose figure proves nothing is owed any more (FUT-4951). */
const provenBack = (claimed: RefundSeriesRow, seen: Consulted, siblings: readonly RefundSeriesRow[]): boolean =>
  seen.kind === 'OWED' && seen.readBack !== null && isPart(claimed) && baselineOf(claimed) !== null && owedCents(claimed, seen.readBack, siblings) <= 0;

/** A dead claimant held the LAST attempt: consult only, adopt or give up. */
async function close(ctx: SeriesContext, claimed: RefundSeriesRow, siblings: readonly RefundSeriesRow[] = []): Promise<void> {
  if (!(await ctx.host.stillOwed(claimed))) {
    await settle(ctx, claimed, 'ENDED');
    return;
  }
  const seen = await consult(ctx, claimed, deadline(ctx));
  if (seen.kind === 'BACK') return adopt(ctx, claimed, seen.refundedCents);
  if (provenBack(claimed, seen, siblings)) return adopt(ctx, claimed, claimed.amountCents);
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
  // One doubt per charge (FUT-4951): a part held back by a sibling is deferred in one write, no attempt spent.
  const siblings = isPart(row) ? await siblingsOf(ctx.store, row) : [];
  const blockers = blockersOf(row, siblings, now);
  if (blockers.length > 0) return void (await ctx.store.saveIf({ ...row, nextAt: deferredUntil(blockers, now) }, row.version));
  const state = due === 'CLOSE' ? { ...row, claimedAt: now.toISOString() } : nextClaim(now, row);
  // The claim's expiry is its `nextAt`, so the sweep finds a dead claimant.
  const claimed = await ctx.store.saveIf(withState(row, { ...state, nextAt: claimExpiry(now) }), row.version);
  if (!claimed) return;
  return due === 'CLOSE' ? close(ctx, claimed, siblings) : attempt(ctx, claimed, siblings);
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
    ? ctx.store.saveIf({ ...stored, ...rowFields(key), ...state, of: undefined, ...baselineFor(stored, key) }, stored.version)
    : ctx.store.insert({ ...rowFields(key), ...state });
}

/** A series still running, or an attempt of it in flight. */
const running = (current: RefundSeriesRow | null, now: Date): boolean => current !== null && (!current.exhausted || claimHeld(current, now));

/** "Tentar estornar de novo": a new series, attempt 1 now with a consult; a no-op while one runs (C21, C22). */
export async function pressSeries(ctx: SeriesContext, key: RefundSeriesKey): Promise<RefundSeriesView | null> {
  const stored = await ctx.store.find(key.provider, key.providerChargeId, key.subject);
  const current = live(stored, key) ? stored : null;
  // Settled for THIS claim as money back (refunded, adopted, by hand): nothing is owed through it. A series
  // only ENDED (an undo that kept its claim) is restartable: the host asked, so the money is owed (review R2).
  if (stored && !current && stored.boundTo === key.boundTo && stored.settledHow !== 'ENDED') return null;
  // A series still running (or an attempt in flight): the press answers it, never a second one.
  if (running(current, ctx.clock())) return seriesView(ctx, current);
  const siblings = await pressSiblings(ctx.store, stored, ctx.clock());
  // Another series of the charge may have moved money: the press waits for it (one doubt per charge).
  if (siblings === null) return seriesView(ctx, current);
  const claimed = await claimNewSeries(ctx, key, stored, current);
  if (claimed) await attempt(ctx, claimed, siblings);
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

/**
 * Open a series whose attempt 1 is due NOW, for the sweep to send (FUT-4740
 * Q2: a refund held before the retry existed). Nothing is sent here, and a
 * charge that already has a row is left as it is: false.
 */
export async function openDueSeries(ctx: SeriesContext, key: RefundSeriesKey): Promise<boolean> {
  const now = ctx.clock().toISOString();
  const state: RefundRetryState = { series: 1, attempt: 0, nextAt: now, exhausted: false, refusal: null, claimedAt: null, reported: false };
  return (await ctx.store.insert({ ...rowFields(key), ...state })) !== null;
}

/** A "by hand" that did not hold (the host's own write failed): the series reads pending again, nothing sent (S3). */
export async function reopenByHand(ctx: SeriesContext, key: RefundSeriesKey): Promise<void> {
  const row = await ctx.store.find(key.provider, key.providerChargeId, key.subject);
  if (!row || row.settledHow !== 'BY_HAND' || row.boundTo !== key.boundTo) return;
  await ctx.store.saveIf({ ...row, settledAt: null, settledHow: null, exhausted: true, nextAt: null, claimedAt: null }, row.version);
}
