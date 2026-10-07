import { claimRearm, REARM_QUIET_MS } from "./poll-rearm";

/**
 * What a realtime hint does to a running payment wait (FUT-3205).
 *
 * A hint is NOT a re-arm. `poke`'s quiet window exists to collapse
 * `visibilitychange` and `online` bursts, and a hint is a server fact.
 * Deferring it by that window cost a paid buyer a full second on the pay step
 * (P-040: the hint at 12,145 ms, the second read at 13,148 ms). So, by the
 * loop's state:
 *
 * - The wait ended (settled, stopped, cancelled): nothing (FUT-1144).
 * - No ask in flight: ask now.
 * - An ask in flight for `REARM_QUIET_MS` or longer: supersede it the way
 *   `poke` does, within `claimRearm`'s budget — the hung-socket case (FUT-1259).
 * - Otherwise, or with that budget spent: keep the ask and MARK the run. One
 *   more ask is owed the moment it answers non-terminal, so a hint is never
 *   dropped (FUT-649), and a burst of hints during one ask costs one extra ask.
 *
 * The mark is cleared by `restart`, by a `poke` that supersedes the marked
 * ask, by sending its follow-up and by a terminal answer. The deadline does
 * NOT clear it: a marked ask answering after the deadline is stopped by the
 * loop's `carriesOn` (FUT-3222) before the mark is read, and neither asks nor
 * schedules; the next `restart` clears the mark.
 *
 * Structural state, as in `poll-rearm.ts`: the loop's run satisfies it.
 */
interface HintState {
  cancelled: boolean;
  settled: boolean;
  stopped: boolean;
  inFlight: boolean;
  askedAt: number;
  supersededAsks: number;
  hinted: boolean;
}

/** Take a hint: whether the loop must ask now. Marks the run when it may not. */
export function claimHint(run: HintState): boolean {
  if (run.cancelled || run.settled || run.stopped) return false;
  const young = run.inFlight && Date.now() - run.askedAt < REARM_QUIET_MS;
  if (!run.inFlight || (!young && claimRearm(run))) {
    run.hinted = false;
    return true;
  }
  run.hinted = true;
  return false;
}

/**
 * After a non-terminal answer to a wait that is still running: whether a mark
 * owes one more ask now, rather than the usual schedule. Clears the mark. A
 * wait that stopped while the ask was out never gets here (`carriesOn`).
 */
export function owedAfterAnswer(run: Pick<HintState, "hinted">): boolean {
  if (!run.hinted) return false;
  run.hinted = false;
  return true;
}
