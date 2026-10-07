/**
 * The host's realtime channel for THIS buyer, handed to every payment wait
 * below it (FUT-649).
 *
 * Nothing here knows what the channel is. A host that can hear an order move —
 * a signed-in buyer's own topic, say — passes whether that channel is live and
 * a way to be told when it fires; every wait under the provider then asks the
 * moment it fires, and keeps no timer of its own while the channel is live
 * (FUT-3223, `poll-live.ts`). A tree with no provider, or a host that passes
 * `live: false` (a guest, who has no channel of their own), polls exactly as
 * before.
 *
 * The hint carries nothing and is never trusted as an answer: it only makes the
 * wait ask `/status` now. The endpoint stays the truth.
 */
import { createContext, useCallback, useContext, useEffect, useRef, type JSX, type ReactNode } from "react";

import type { PollLoop } from "./poll-loop";
import { REARM_QUIET_MS } from "./poll-rearm";

/** What a host hands the checkout about its own realtime channel. */
export interface CheckoutLiveSignal {
  /** Whether the channel is connected right now. */
  live: boolean;
  /**
   * Be told when the channel says this buyer's orders moved. Returns the
   * unsubscribe. Should be stable across renders: a new function re-subscribes.
   */
  subscribe: (onHint: () => void) => () => void;
  /**
   * The healthy delay while live (ms) for the one wait that keeps reading while
   * live: a hosted-checkout return carrying the settlement pair (`poll-live.ts`).
   * Every other wait keeps no timer while live. Defaults to
   * {@link DEFAULT_LIVE_INTERVAL_MS}.
   */
  liveIntervalMs?: number;
}

/**
 * The floor a hosted-checkout return keeps while the channel is live: the same
 * 15 s the PIX wait already backs off to, so a wait whose channel is up never
 * asks faster than the slowest wait it would have become anyway.
 */
export const DEFAULT_LIVE_INTERVAL_MS = 15_000;

const CheckoutLiveContext = createContext<CheckoutLiveSignal | null>(null);

/** Hand every payment wait below the host's channel. */
export function CheckoutLiveProvider({
  signal,
  children,
}: {
  signal: CheckoutLiveSignal;
  children: ReactNode;
}): JSX.Element {
  return <CheckoutLiveContext.Provider value={signal}>{children}</CheckoutLiveContext.Provider>;
}

/** What one wait reads off the provider, for `createPollLoop`. */
interface LiveWait {
  isLive: () => boolean;
  liveIntervalMs: number;
}

type LoopRef = { readonly current: PollLoop | null };

/**
 * A channel that DROPS: ask now — and if the loop declines because it asked a
 * moment ago, ask again once that quiet window is over. The ask it lands just
 * after may have been answered before the drop, and a live wait books no next
 * tick, so declining for good would leave the buyer waiting with nobody left
 * to wake them.
 *
 * A channel that (RE-)OPENS does not come here either: it is taken as a HINT
 * (FUT-3223). A hint sent while the channel was down was never heard, and a
 * live wait has no timer to catch it, so the open is the re-read that bounds a
 * lost hint — and `PollLoop.hint` never drops it: with an ask in flight it
 * owes one more the moment that ask answers, where a declined poke could leave
 * a pre-open answer as the last word.
 *
 * A HINT does not come here. It is `PollLoop.hint` (FUT-3205): deferring a
 * hint by the quiet window cost a paid buyer a full second on the pay step.
 */
function wake(loop: LoopRef, pending: { timer?: ReturnType<typeof setTimeout> }): void {
  if (loop.current?.poke() !== false) return;
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => loop.current?.poke(), REARM_QUIET_MS);
}

/**
 * Tie one wait to the host's channel: a hint asks now, a channel that DROPS
 * asks now too (see {@link wake}), and a channel that (RE-)OPENS is taken as a
 * hint. The channel's state at mount needs no ask of its own: the wait's first
 * ask is already that read.
 *
 * `loop` is the hook's own ref to its running loop, read when the event lands.
 */
export function useLiveWait(loop: LoopRef): LiveWait {
  const signal = useContext(CheckoutLiveContext);
  const live = signal?.live === true;
  const liveRef = useRef(live);
  const pending = useRef<{ timer?: ReturnType<typeof setTimeout> }>({});
  const subscribe = signal?.subscribe;

  useEffect(() => {
    const was = liveRef.current;
    liveRef.current = live;
    if (was && !live) wake(loop, pending.current);
    else if (!was && live) loop.current?.hint();
  }, [live, loop]);

  useEffect(() => {
    if (!subscribe) return undefined;
    const retry = pending.current;
    const unsubscribe = subscribe(() => loop.current?.hint());
    return () => {
      unsubscribe();
      clearTimeout(retry.timer);
    };
  }, [subscribe, loop]);

  // Stable, so the loop's deps do not churn: the loop reads the flag when it
  // schedules, and a flip must never restart the wait's wall clock.
  const isLive = useCallback(() => liveRef.current, []);
  return { isLive, liveIntervalMs: signal?.liveIntervalMs ?? DEFAULT_LIVE_INTERVAL_MS };
}
