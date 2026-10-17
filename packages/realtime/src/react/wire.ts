import type { RealtimeMessage, RealtimeTransport, RealtimeTransportConfig, WireSource, WireSourceFactory } from "./types";
import { createWebSocketSource } from "./ws-source";

/**
 * The two pure helpers `./connection.ts` builds on — which wire to open, and how
 * to read a frame off it — kept apart so the channel itself stays under the size
 * gate.
 */

/**
 * The browser transport for one attempt. `null` where neither is available (SSR, old
 * engines).
 *
 * WebSocket is not behind a build flag (FUT-643). It was, briefly, and the flag was a
 * mistake twice over: `import.meta.env` is inlined at build time, so the "rollback is
 * a config change" it promised would in fact have needed a rebuild — and defaulting
 * it off shipped the socket as dead code that no environment ever ran. The safety it
 * was reaching for belongs at runtime, where it can observe what actually happened,
 * and that is {@link RealtimeChannel}'s ws→sse demotion.
 *
 * The `null` fall-through from `createWebSocketSource` is the engine-capability case
 * (no `WebSocket` global) and is separate from that demotion: this one is knowable
 * before a connection is attempted, so it costs no failed attempt.
 */
export function makeDefaultSourceFactory(
  transport: RealtimeTransportConfig | undefined,
): WireSourceFactory {
  return (url: string, wire: RealtimeTransport): WireSource | null => {
    if (wire === "ws") {
      const socket = createWebSocketSource(url, transport);
      if (socket) return socket;
    }
    if (typeof EventSource === "undefined") return null;
    // One contained cast: the DOM handler types carry event-object parameters this
    // seam deliberately widens to `unknown`.
    return new EventSource(url) as unknown as WireSource;
  };
}

/** Parse one wire payload, or `null` for anything malformed. */
export function decodeMessage(raw: string): RealtimeMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof (parsed as RealtimeMessage).topic === "string" &&
      typeof (parsed as RealtimeMessage).type === "string"
    ) {
      return parsed as RealtimeMessage;
    }
    return null;
  } catch {
    return null;
  }
}
