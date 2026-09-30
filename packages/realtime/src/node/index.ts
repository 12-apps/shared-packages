import { RealtimeChannel, type RealtimeChannelOptions } from "../react/connection";
import type { RealtimeTransportConfig } from "../react/types";
import { createWebSocketSource } from "../react/ws-source";

import { createSseSource, type SseSourceOptions } from "./sse-source";

/**
 * `@12-apps/realtime/node` — subscribing from a runtime that is not a browser.
 *
 * A desktop agent, a worker, a CLI that watches a store: each wants the exact
 * behaviour the browser client already has, and none of them has `EventSource`.
 * So this entry point is deliberately thin — an event-stream
 * {@link createSseSource} plus a factory that plugs it into the SAME
 * `RealtimeChannel` the browser drives.
 *
 * **The socket is the primary wire here, exactly as it is in a tab.** An
 * earlier version of this file said "`transport` is accepted and ignored: there
 * is no socket here", and that was wrong in a way that is invisible from
 * outside: the channel reported `connected`, so a consumer looked live while
 * running on the demotion. The package's own `createWebSocketSource` is
 * runtime-agnostic — its two browser dependencies, the ticket `fetch` and the
 * endpoint `location`, are both seams — so the node factory below is the same
 * ws-then-sse shape the browser's default factory has, with
 * {@link createSseSource} where a tab would put `EventSource`.
 *
 * Nothing about the CONTRACT changes with the runtime, and the two that bite
 * hardest are worth restating where a new consumer will read them:
 *
 *   - **Keep your poll.** An event is a hint to re-read, never the data, and
 *     delivery is best-effort. A consumer that stopped polling because the
 *     channel says `connected` has replaced a slow answer with a wrong one.
 *   - **Events carry identifiers.** Re-read through the endpoint that already
 *     decides what this subject may see; the envelope decides nothing.
 *
 * The React half (`../react`) is not importable here — it pulls React in — and
 * does not need to be: everything this file touches is framework-free.
 */
export { createSseSource, type SseSourceOptions } from "./sse-source";
export { SseDecoder } from "./sse-decoder";
export { createWebSocketSource, fetchRealtimeTicket, ticketUrlFor } from "../react/ws-source";
export type { RealtimeTransportConfig } from "../react/types";

export type { RealtimeMessage, RealtimeStatus } from "../react/types";

/**
 * The polling seams, which bind a node consumer exactly as they bind a tab:
 * realtime RELAXES a poll and never replaces it.
 */
export { fallbackRefetchInterval, reconcileRefetchInterval } from "../core/polling";
export { RealtimeChannel, type RealtimeChannelOptions } from "../react/connection";

/** A node channel: {@link RealtimeChannelOptions} minus the seam we fill. */
export interface NodeChannelOptions extends Omit<RealtimeChannelOptions, "createSource"> {
  /** How the stream is opened — the credential seam. See {@link SseSourceOptions}. */
  sse?: SseSourceOptions;
}

/**
 * Where the gateway listens, derived from the subscribe URL.
 *
 * A browser reads this off `location`; a process has none, and guessing from
 * the environment would be worse than deriving it from the one URL the caller
 * has already given us. Same origin, `/ws` — the reverse-proxy arrangement the
 * browser default assumes, so both wires agree about where the gateway is.
 *
 * A host whose gateway lives elsewhere names it through `transport.socketUrl`,
 * which takes precedence and is what this defaults.
 */
export function socketUrlFor(subscribeUrl: string): string {
  const url = new URL(subscribeUrl);
  return `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}/ws`;
}

/**
 * Open one subscription, socket first, with the browser client's own recovery.
 *
 * Connects on construction and reconnects for ever until `close()`, exactly as
 * it does in a tab — and over the same wires, in the same order: the gateway's
 * WebSocket when one can be opened, {@link createSseSource} when it cannot.
 * That order is not a preference. The socket is the only wire with a
 * client→server half, so `subscribe`, `unsubscribe` and `ping` exist only on
 * it, and its reconnect costs one frame where the stream costs a request.
 *
 * **The ticket round trip is authenticated and the stream is authenticated, and
 * they are separate requests.** A consumer that passes credentials to `sse` and
 * not to `transport.fetchTicket` gets a 401 on the ticket, no socket, and a
 * working stream — i.e. it lands back on the demotion without being told. Pass
 * the same fetch to both.
 */
export function createNodeChannel(options: NodeChannelOptions): RealtimeChannel {
  const { sse, transport, ...channel } = options;
  const resolved: RealtimeTransportConfig = {
    socketUrl: socketUrlFor(options.url),
    ...transport,
  };
  return new RealtimeChannel({
    ...channel,
    transport: resolved,
    createSource: (url, wire) => {
      if (wire === "ws") {
        const socket = createWebSocketSource(url, resolved);
        if (socket) return socket;
      }
      return createSseSource(url, sse);
    },
  });
}
