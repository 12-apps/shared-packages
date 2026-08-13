import { useEffect, useRef, useState } from "react";

import { RealtimeChannel } from "./connection";
import type {
  RealtimeMessage,
  RealtimeStatus,
  RealtimeTransportConfig,
  WireSourceFactory,
} from "./types";

/**
 * The polling seams every consumer keys off, and a STANDALONE channel hook for a
 * component that does not sit under a provider.
 *
 * The two rules in one line: keep your `refetchInterval`, and treat every message as
 * "invalidate and re-read", never as the data.
 */

/**
 * The query-client seam: pass the result straight to `refetchInterval`.
 *
 * Polling PAUSES only while the stream is live (events arrive pushed and each one
 * should invalidate the matching query); any other state keeps today's polling exactly
 * as it is — that is the no-regression contract.
 *
 * Only correct where a missed event cannot MISLEAD. Prefer
 * {@link reconcileRefetchInterval} otherwise.
 */
export function fallbackRefetchInterval(
  status: RealtimeStatus,
  pollMs: number,
): number | false {
  return status === "connected" ? false : pollMs;
}

/**
 * The OTHER query-client seam, and the default choice (FUT-440): a poll that keeps
 * RECONCILING while the stream is live instead of pausing outright.
 *
 * {@link fallbackRefetchInterval} suits a surface that can prove it heard everything. A
 * board cannot: delivery is best-effort and there is no replay, so a screen that stops
 * polling the moment it stops hearing has no route back to the truth until something
 * else happens to move. Hence a SLOW poll while connected — `reconcileMs` is the ceiling
 * on how long one dropped hint may leave a screen wrong — and the surface's existing
 * fast poll (`fallbackMs`) on every other status, which is the no-regression contract
 * unchanged.
 *
 * Never `false`: the whole point is that the poll never stops.
 */
export function reconcileRefetchInterval(
  status: RealtimeStatus,
  fallbackMs: number,
  reconcileMs: number,
): number {
  return status === "connected" ? reconcileMs : fallbackMs;
}

export interface UseRealtimeOptions {
  /**
   * The subscribe endpoint URL with its `?topics=`, or `null`/`undefined` to keep
   * realtime off (no tenant yet, feature-flagged out) — the status then stays
   * "disconnected" and consumers simply poll.
   */
  url: string | null | undefined;
  /**
   * Called per received event — the place to invalidate a query, typically keyed by
   * `message.topic`. Reads the latest callback each event; no need to memoize.
   */
  onMessage?: (message: RealtimeMessage) => void;
  /** Where the ws/ticket endpoints live, when they are not the defaults. */
  transport?: RealtimeTransportConfig;
  /** Test/transport seam — leave unset in app code. */
  createSource?: WireSourceFactory;
}

export interface UseRealtimeResult {
  status: RealtimeStatus;
  /** Sugar for `status === "connected"`. */
  connected: boolean;
}

/**
 * Subscribe to realtime topics while mounted, on a channel of this component's own.
 *
 * A screen inside an app that mounts `createWebEvents().Provider` should use
 * `useTopics` instead — that shares the shell's one connection. This hook is for a
 * component with no shell above it.
 */
export function useRealtime(options: UseRealtimeOptions): UseRealtimeResult {
  const { url, createSource, transport } = options;
  const [status, setStatus] = useState<RealtimeStatus>("disconnected");

  // Latest-callback ref so a consumer's inline `onMessage` closure never forces a
  // reconnect cycle.
  const onMessageRef = useRef(options.onMessage);
  onMessageRef.current = options.onMessage;

  useEffect(() => {
    if (!url) {
      setStatus("disconnected");
      return undefined;
    }
    const channel = new RealtimeChannel({
      url,
      transport,
      createSource,
      onStatusChange: setStatus,
      onMessage: (message) => onMessageRef.current?.(message),
    });
    return () => channel.close();
  }, [url, createSource, transport]);

  return { status, connected: status === "connected" };
}
