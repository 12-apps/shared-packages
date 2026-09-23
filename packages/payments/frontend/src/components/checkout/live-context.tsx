/**
 * The host's realtime channel for THIS buyer, handed to every payment wait
 * below it (FUT-649).
 *
 * Nothing here knows what the channel is. A host that can hear an order move —
 * a signed-in buyer's own topic, say — passes whether that channel is live and
 * a way to be told when it fires; every wait under the provider then asks the
 * moment it fires and slows its own timer while the channel is live. A tree with
 * no provider, or a host that passes `live: false` (a guest, who has no channel
 * of their own), polls exactly as before.
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
  /** The wait's healthy delay while live (ms). Defaults to {@link DEFAULT_LIVE_INTERVAL_MS}. */
  liveIntervalMs?: number;
}

/**
 * The floor under a lost hint while the channel is live: the same 15 s the PIX
 * wait already backs off to, so a wait whose channel is up never asks faster
 * than the slowest wait it would have become anyway.
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
export interface LiveWait {
  isLive: () => boolean;
  liveIntervalMs: number;
}

type LoopRef = { readonly current: PollLoop | null };

/**
 * Ask now — and if the loop declines because it asked a moment ago, ask again
 * once that quiet window is over. The window exists so a flapping network does
 * not stampede `/status`; a hint is different, because the ask it lands just
 * after may have been answered BEFORE the order moved. Dropping it would leave
 * the buyer on the live floor with the news already sent.
 */
function wake(loop: LoopRef, pending: { timer?: ReturnType<typeof setTimeout> }): void {
  if (loop.current?.poke() !== false) return;
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => loop.current?.poke(), REARM_QUIET_MS);
}

/**
 * Tie one wait to the host's channel: a hint asks now, and a channel that
 * DROPS asks now too — the timer may be sleeping out the live floor, and the
 * buyer should not wait the rest of it with nobody left to wake them.
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
  }, [live, loop]);

  useEffect(() => {
    if (!subscribe) return undefined;
    const retry = pending.current;
    const unsubscribe = subscribe(() => wake(loop, retry));
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
