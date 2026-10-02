import { withLive } from "./poll-live";
import type { PollingOptions } from "./poll-loop";

/**
 * How long a payment wait sleeps before its next ask — pure functions of the
 * options and the run's counters, split out of `poll-loop.ts` so the loop
 * stays one question: WHEN to ask, not how long.
 */

/**
 * The slowest a failing poll may go (FUT-1144).
 *
 * Consecutive failures double the delay — 2.5 s, 5 s, 10 s — and stop there.
 * The cap is what keeps the recovery cheap: a shopper whose signal comes back
 * during a Wi-Fi→4G handoff waits at most this long to be told they paid, and
 * the re-arm events (`poll-rearm.ts`) usually beat it outright.
 */
const MAX_ERROR_BACKOFF_MS = 10_000;

/**
 * How long before the next ask, given how many healthy polls have happened.
 *
 * A pure function of the options, so it lives out here rather than inside the
 * effect — the hook is at its size gate, and a scheduling RULE is easier to
 * read (and to test) stated once than threaded through a closure.
 *
 * Reads the count AFTER the poll just made, so the slow phase begins on the
 * poll FOLLOWING the threshold rather than one early: a wait described as "N
 * fast polls" has to actually make N of them.
 */
function healthyDelay(healthy: number, options: PollingOptions): number {
  const { intervalMs = 2500, slowAfterPolls, slowIntervalMs } = options;
  const backingOff =
    slowAfterPolls !== undefined && slowIntervalMs !== undefined && healthy >= slowAfterPolls;
  return withLive(backingOff ? slowIntervalMs : intervalMs, options);
}

/**
 * The same rule with consecutive FAILURES folded in (FUT-1144).
 *
 * Errors never stop the wait, they only slow it. Doubling from the healthy
 * cadence is what makes a ten-second blip cost one extra beat instead of the
 * whole confirmation: four failures used to be terminal, and four failures is
 * what a Wi-Fi→4G handoff produces at the default 2.5 s.
 *
 * The cap is `MAX_ERROR_BACKOFF_MS` or the healthy cadence, whichever is
 * larger — a failing poll must never ask FASTER than a succeeding one, which
 * is what a bare cap would do to a consumer whose slow interval is longer.
 */
export function pollDelay(healthy: number, errors: number, options: PollingOptions): number {
  const base = healthyDelay(healthy, options);
  if (errors === 0) return base;
  return Math.min(base * 2 ** (errors - 1), Math.max(base, MAX_ERROR_BACKOFF_MS));
}
