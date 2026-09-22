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
 * The two polling seams moved to `../core/polling` so the node half can reach
 * them without importing React (12-89). Re-exported here because they are part
 * of this module's published surface and every existing consumer imports them
 * from it.
 */
export { fallbackRefetchInterval, reconcileRefetchInterval } from "../core/polling";

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
