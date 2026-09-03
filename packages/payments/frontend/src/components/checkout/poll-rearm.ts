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
 * import back into the loop that imports it. Module-private — the loop passes
 * its run and never names this type, so exporting it is an unused export.
 */
interface RearmState {
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
 * 5s → 10s backoff never engages, and the wait sits near one request per window
 * instead of decaying to one per ten.
 *
 * So the budget: after this many abandoned asks with no answer in between, a
 * re-arm stands down and lets the in-flight ask either return or hit its own
 * `askTimeoutMs`. Either outcome reaches `absorb`, which refills the budget, so
 * this only bites while genuinely nothing is getting through.
 *
 * **What it does NOT bound: the re-arm rate itself.** A re-arm that finds the
 * loop idle spends nothing, so on a link whose asks RESOLVE inside the window —
 * a fast 500, or the immediate `TypeError: Load failed` iOS raises for a killed
 * socket — six `online` events still cost six requests, exactly as before. That
 * flavour is bounded by {@link REARM_QUIET_MS} alone and always was. This
 * constant is about the ask that hangs, which is the one the quiet window
 * could not see.
 */
const MAX_SUPERSEDED_ASKS = 3;

/**
 * Decide whether a re-arm may proceed, and account for it if it may.
 *
 * Named `claim` rather than `may…` because it MUTATES on success: a re-arm that
 * abandons a live ask spends one of the budget above. A re-arm that finds no
 * ask in flight — the loop is simply between ticks — spends nothing, since
 * there is no request to amplify.
 *
 * That second rule is what makes a denial safe, and it is an invariant worth
 * stating: `supersededAsks > 0` implies `inFlight`, because every transition to
 * `inFlight === false` in a live run either passes through `absorb` (which
 * refills) or is followed synchronously by a `tick`. So a re-arm arriving at an
 * IDLE loop is never denied, whatever the budget reads.
 *
 * The cost of a denial, stated honestly: the fourth consecutive return from the
 * bank app does NOT poll immediately. It waits for the in-flight ask to resolve
 * or reach `askTimeoutMs` (15s by default), plus one backoff step — so worst
 * case the buyer learns they paid roughly 17s later than they would have. That
 * is the price of not hammering `/status` on a link that is answering nothing,
 * and the buyer's own "Verificar de novo" (`restart`) resets the budget outright.
 */
export function claimRearm(run: RearmState): boolean {
  if (Date.now() - run.askedAt < REARM_QUIET_MS) return false;
  if (!run.inFlight) return true;
  if (run.supersededAsks >= MAX_SUPERSEDED_ASKS) return false;
  run.supersededAsks += 1;
  return true;
}
