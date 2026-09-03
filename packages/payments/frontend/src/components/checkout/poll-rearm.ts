/**
 * When a re-arm may abandon an ask that is still in flight (FUT-1259).
 *
 * `visibilitychange` and `online` drive the loop's `poke`, and both fire for
 * the same reason the wait exists: the shopper went to their bank app and came
 * back, and the request left behind is quite likely a socket that died while
 * the screen was hidden. Abandoning it is right. Abandoning it EVERY time is
 * what this module bounds.
 */

/**
 * The state a re-arm decision reads. Structural on purpose: the poll loop's own
 * run object satisfies it, and typing it that way keeps this module free of an
 * import back into the loop that imports it.
 */
export interface RearmState {
  inFlight: boolean;
  askedAt: number;
  supersededAsks: number;
}

/**
 * How long a re-arm must stay quiet after the last ask.
 *
 * Returning to a tab commonly fires `visibilitychange` and `online` together —
 * and a shopper flicking between the bank app and the store fires them again
 * per trip. This collapses a burst into one request without delaying it: the
 * first re-arm of a burst polls immediately, the rest fall inside the gap.
 */
const REARM_QUIET_MS = 1_000;

/**
 * How many live asks a re-arm may abandon before it has to let one finish.
 *
 * The quiet window alone looked sufficient and is not, because it is measured
 * against the CURRENT ask rather than against the previous re-arm. Once a round
 * trip runs longer than the window — which is the ordinary state of the flaky
 * link this whole feature exists for — every re-arm supersedes an ask that was
 * still alive. Nothing is ever absorbed, so `errors` never rises, so the 2.5s →
 * 5s → 10s backoff never engages, and a handset whose OS reports `online` at
 * roughly 1Hz sits pinned near one request per second instead of decaying to
 * one per ten. That is ~10x the status traffic, spent precisely on the networks
 * least able to carry it.
 *
 * So the budget: after this many abandoned asks with no answer in between, a
 * re-arm stands down and lets the in-flight ask either return or hit its own
 * `askTimeoutMs`. Either outcome reaches `absorb`, which refills the budget —
 * so this only ever bites while genuinely nothing is getting through, and the
 * shopper who really did just come back from their bank app still gets the
 * immediate poll they came back for.
 */
const MAX_SUPERSEDED_ASKS = 3;

/**
 * Decide whether a re-arm may proceed, and account for it if it may.
 *
 * Named `claim` rather than `may…` because it MUTATES on success: a re-arm that
 * abandons a live ask spends one of the budget above. A re-arm that finds no
 * ask in flight — the loop is simply between ticks — spends nothing, since
 * there is no request to amplify.
 */
export function claimRearm(run: RearmState): boolean {
  if (Date.now() - run.askedAt < REARM_QUIET_MS) return false;
  if (!run.inFlight) return true;
  if (run.supersededAsks >= MAX_SUPERSEDED_ASKS) return false;
  run.supersededAsks += 1;
  return true;
}
