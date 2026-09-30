/**
 * The cadence a payment wait keeps while the host HEARS the order move
 * (FUT-649).
 *
 * The wait asks `/status` every 2.5 s because, on its own, asking is the only
 * way it can learn that a webhook settled the order in another process. A host
 * that holds a realtime channel for this buyer already learns it the moment it
 * happens — `CheckoutLiveProvider` hands that hint in and the wait asks at once.
 * While that channel is live the timer is only the floor under a lost hint, so
 * it slows to {@link LiveCadence.liveIntervalMs}; the moment the channel drops,
 * the ordinary cadence is back on the next tick.
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
   * The healthy delay while live (ms). A floor, never a speed-up: a slower
   * cadence already in force (the PIX backoff) is kept.
   */
  liveIntervalMs?: number;
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
