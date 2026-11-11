import { ProviderRequestError } from './errors';

/**
 * The refund retry schedule (FUT-4360), provider-free so the evidence Pix and
 * the store refunds (FUT-4740) read the same one.
 *
 * A refund a provider cannot take yet ("not yet", then a transport error, a
 * 5xx) is retried in the BACKGROUND, never inside the request that first met
 * the refusal: at most {@link REFUND_RETRY_ATTEMPTS} attempts, spaced with
 * exponential backoff (5 minutes, then 10). After the last one nothing runs by
 * itself: a person decides.
 */

/** What a provider's refusal of a refund means for the next attempt. */
export type RefundRefusal =
  /** The provider says "not yet": the same refund will be taken later. */
  | 'NOT_YET'
  /** The provider refused for good: waiting changes nothing. */
  | 'REFUSED'
  /** No verdict (a 5xx, a timeout, a transport error): the refund may even have happened. */
  | 'UNKNOWN';

/** Attempts per series, the first one included. */
export const REFUND_RETRY_ATTEMPTS = 3;

/** The pause before attempt n + 1 is `[n - 1]`: 5 minutes, then 10. */
export const REFUND_RETRY_DELAYS_MS: readonly number[] = [5 * 60_000, 10 * 60_000];

/**
 * When the next attempt is due, given how many were made and when the last one
 * was made; null once {@link REFUND_RETRY_ATTEMPTS} were made.
 */
export function refundRetryAt(attemptsMade: number, lastAttemptAt: Date): Date | null {
  if (attemptsMade < 1 || attemptsMade >= REFUND_RETRY_ATTEMPTS) return null;
  const pause = REFUND_RETRY_DELAYS_MS[attemptsMade - 1];
  return pause === undefined ? null : new Date(lastAttemptAt.getTime() + pause);
}

/**
 * The `providerCode` an adapter puts on the error it throws when the charge it
 * was asked to refund has nothing left to refund — already refunded, by an
 * earlier cancel whose answer was lost or by the owner in the provider's panel.
 * A caller that owns the refund adopts it as done instead of treating it as a
 * failure; read from the code, never from the message.
 */
export const NOTHING_TO_REFUND = 'NOTHING_TO_REFUND';

/**
 * A series whose attempt 1 had NO answer (a timeout, a transport error, a
 * 5xx) is retried by itself sooner and once more (owner, FUT-4740 Q1): at
 * T0 + 30 s, T0 + 5 min and T0 + 15 min, four attempts in all. Every attempt
 * after the first consults the charge first, so a refund that landed is adopted.
 */
export const REFUND_NO_ANSWER_ATTEMPTS = 4;

/** The pauses of a no-answer series: 30 s, then 4 min 30 s, then 10 min. */
export const REFUND_NO_ANSWER_DELAYS_MS: readonly number[] = [30_000, 270_000, 10 * 60_000];

/** How many attempts a series makes and the pause before each later one. */
export interface RefundSchedule {
  attempts: number;
  delaysMs: readonly number[];
}

const NOT_YET_SCHEDULE: RefundSchedule = { attempts: REFUND_RETRY_ATTEMPTS, delaysMs: REFUND_RETRY_DELAYS_MS };

/** PG1's schedule whatever attempt 1 answered: the evidence Pix and card cancels keep it (FUT-4360). */
export const pg1Schedule = (): RefundSchedule => NOT_YET_SCHEDULE;
const NO_ANSWER_SCHEDULE: RefundSchedule = { attempts: REFUND_NO_ANSWER_ATTEMPTS, delaysMs: REFUND_NO_ANSWER_DELAYS_MS };

/** The schedule a series follows, picked by its attempt 1's answer; a "not yet" (or anything else) keeps PG1's. */
export function refundScheduleFor(firstRefusal: RefundRefusal | null): RefundSchedule {
  return firstRefusal === 'UNKNOWN' ? NO_ANSWER_SCHEDULE : NOT_YET_SCHEDULE;
}

/** The schedule of a series by its length (a state written before Q1 has none: 3). */
function scheduleOfLength(attempts: number | undefined): RefundSchedule {
  return attempts === REFUND_NO_ANSWER_ATTEMPTS ? NO_ANSWER_SCHEDULE : NOT_YET_SCHEDULE;
}

/** {@link refundRetryAt} for a given schedule. */
export function refundRetryAtOn(schedule: RefundSchedule, attemptsMade: number, lastAttemptAt: Date): Date | null {
  if (attemptsMade < 1 || attemptsMade >= schedule.attempts) return null;
  const pause = schedule.delaysMs[attemptsMade - 1];
  return pause === undefined ? null : new Date(lastAttemptAt.getTime() + pause);
}

/**
 * Where a refund stands between attempts, whoever keeps it: the evidence run's
 * step (FUT-4360) or a store refund's series row (FUT-4740). Moved here from
 * `platform/evidence/refund-state.ts`, which re-exports it.
 */
export interface RefundRetryState {
  /** Each press of "Tentar estornar de novo" starts a new series, from 1. */
  series: number;
  /** Attempts CLAIMED in this series: a process that died holding one still counts. */
  attempt: number;
  /** The series' length (3, or 4 for a no-answer series); absent on a state written before it: 3. */
  of?: number;
  /** When the next automatic attempt is due, ISO-8601; null when none will run by itself. */
  nextAt: string | null;
  /** No automatic attempt is left: out of attempts, or the provider refused for good. */
  exhausted: boolean;
  refusal: RefundRefusal | null;
  /** When an attempt claimed the right to send its cancel, while it has not answered. */
  claimedAt: string | null;
  /** The error tracker has heard of this series' give-up (once per series). */
  reported: boolean;
}

/**
 * How long one attempt may hold its claim, and the deadline its provider calls
 * (the read-back and the cancel, together) run under. The deadline is an
 * AbortSignal the adapter honours, so an attempt is over 90 s after it started
 * whatever the provider does, and 30 s of margin remain before another actor
 * may treat the claim as dead: a second cancel can never overlap a live one.
 */
export const REFUND_CLAIM_TTL_MS = 120_000;
export const REFUND_ATTEMPT_DEADLINE_MS = 90_000;

/** The series' length. */
export const attemptsOf = (state: Pick<RefundRetryState, 'of'>): number => state.of ?? REFUND_RETRY_ATTEMPTS;

/** The claim is in force: its attempt may still be running. */
export function claimHeld(state: Pick<RefundRetryState, 'claimedAt'>, now: Date): boolean {
  return state.claimedAt !== null && now.getTime() < new Date(state.claimedAt).getTime() + REFUND_CLAIM_TTL_MS;
}

/** A new series' state: attempt 1 claimed now, the previous series' refusal kept for the screen. */
export function firstClaim(now: Date, previous: RefundRetryState | null): RefundRetryState {
  return {
    series: (previous?.series ?? 0) + 1,
    attempt: 1,
    nextAt: null,
    exhausted: false,
    refusal: previous?.refusal ?? null,
    claimedAt: now.toISOString(),
    reported: previous?.reported ?? false,
  };
}

/** The attempt after a claimed one: the next number, claimed now. */
export function nextClaim(now: Date, previous: RefundRetryState): RefundRetryState {
  return { ...previous, attempt: previous.attempt + 1, nextAt: null, claimedAt: now.toISOString() };
}

/**
 * The state after an attempt that did not refund: the next one due, or none.
 * Attempt 1's answer fixes the series' length (Q1); a refusal for good ends it.
 */
export function afterRefusal(
  state: RefundRetryState,
  refusal: RefundRefusal,
  now: Date,
  scheduleFor: (firstRefusal: RefundRefusal) => RefundSchedule = refundScheduleFor,
): RefundRetryState {
  const of = state.attempt === 1 ? scheduleFor(refusal).attempts : attemptsOf(state);
  const nextAt = refusal === 'REFUSED' ? null : refundRetryAtOn(scheduleOfLength(of), state.attempt, now);
  return { ...state, of, refusal, nextAt: nextAt?.toISOString() ?? null, exhausted: nextAt === null, claimedAt: null };
}

/**
 * What is due on a series right now: `NEXT` (the next attempt's time came, or
 * its claimant died), `CLOSE` (a dead claimant held the LAST attempt: nothing
 * is left to send, only a consult), or null.
 */
export function refundDueNow(state: RefundRetryState, now: Date): 'NEXT' | 'CLOSE' | null {
  if (state.exhausted || claimHeld(state, now)) return null;
  const expiredClaim = state.claimedAt !== null;
  if (!expiredClaim && (state.nextAt === null || now.getTime() < new Date(state.nextAt).getTime())) return null;
  return state.attempt >= attemptsOf(state) ? 'CLOSE' : 'NEXT';
}

/** The adapter's own word that the charge has nothing left to refund: adopted as done. */
export function isNothingToRefund(error: unknown): boolean {
  return error instanceof ProviderRequestError && error.options.providerCode === NOTHING_TO_REFUND;
}

/**
 * What a refusal of a refund means, without a provider's vocabulary: the
 * adapter's own tag (`options.refundRefusal`) when it set one; otherwise an
 * answered 4xx (not 408 or 429, which say "later") is `REFUSED`, and anything
 * else — a 5xx, a timeout, a transport error — `UNKNOWN`.
 */
export function refundRefusalOf(error: unknown): RefundRefusal {
  if (!(error instanceof ProviderRequestError)) return 'UNKNOWN';
  if (error.options.refundRefusal) return error.options.refundRefusal;
  const status = error.options.httpStatus;
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'REFUSED' : 'UNKNOWN';
}
