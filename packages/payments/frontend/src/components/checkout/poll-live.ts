/**
 * The cadence a payment wait keeps while the host HEARS the order move
 * (FUT-649, FUT-3223).
 *
 * The wait asks `/status` every 2.5 s because, on its own, asking is the only
 * way it can learn that a webhook settled the order in another process. A host
 * that holds a realtime channel for this buyer already learns it the moment it
 * happens — `CheckoutLiveProvider` hands that hint in and the wait asks at once.
 * So while that channel is live a healthy answer books NO timer: the wait asks
 * on a hint, on `visibilitychange`/`online`, and when the channel opens or
 * re-opens — a screen hears live data over the socket and polls only while the
 * socket is down. The host's server owns what a timer used to catch: a lapsed
 * code and a webhook that never came are found server-side and published to
 * the same channel. The moment the channel drops, the ordinary cadence is back.
 *
 * Two exceptions keep a timer while live:
 *
 * - A FAILED ask is a read that did not happen, not a check for news, so it
 *   keeps its error backoff. Otherwise a hint whose ask hit a 500 would leave a
 *   paid buyer waiting for a second hint that is never sent.
 * - A wait given {@link LiveCadence.liveIntervalMs} keeps that floor. The hook
 *   gives it one only on a hosted-checkout return carrying the settlement pair
 *   (`carriesSettlementPair`), where the buyer's own read is what confirms the
 *   payment and no server sweep can stand in for it.
 *
 * Split out of `poll-loop.ts` so the loop stays one question: WHEN to ask. This
 * file answers only how being live changes that answer.
 */
export interface LiveCadence {
  /**
   * Whether the host's channel is live right now. Read at every scheduling
   * decision rather than once, so a channel that drops mid-wait takes effect
   * at the next tick instead of at the next restart.
   */
  isLive?: () => boolean;
  /**
   * The healthy delay while live (ms), for a wait that must keep reading while
   * live (see the module docblock). A floor, never a speed-up: a slower cadence
   * already in force (the PIX backoff) is kept. Undefined: no timer while live.
   */
  liveIntervalMs?: number;
}

/**
 * Whether the wait books nothing after this answer and waits to be told: a
 * healthy answer, while live, for a wait with no live floor.
 */
export function idlesWhileLive(errors: number, options: LiveCadence): boolean {
  return errors === 0 && options.liveIntervalMs === undefined && options.isLive?.() === true;
}

/** `delay`, stretched to the live floor while the host's channel is live. */
export function withLive(delay: number, options: LiveCadence): number {
  if (options.liveIntervalMs === undefined || options.isLive?.() !== true) return delay;
  return Math.max(delay, options.liveIntervalMs);
}

/**
 * Whether the wait must stay open until its wall clock actually strikes.
 *
 * The loop normally ends one sleep EARLY when that sleep would cross
 * `maxWaitMs` — nothing could land in it. While live, something can: the hint.
 * Ending early there would hand a 90 s card wait over at 75 s and then refuse
 * the hint that arrives at 80 s, so the armed deadline ends it instead.
 */
export function waitsForDeadline(options: LiveCadence): boolean {
  return options.isLive?.() === true;
}
