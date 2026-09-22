import { RealtimeChannel, type RealtimeChannelOptions } from "../react/connection";

import { createSseSource, type SseSourceOptions } from "./sse-source";

/**
 * `@12-apps/realtime/node` — subscribing from a runtime that is not a browser.
 *
 * A desktop agent, a worker, a CLI that watches a store: each wants the exact
 * behaviour the browser client already has, and none of them has
 * `EventSource`. So this entry point is deliberately thin — an event-stream
 * {@link createSseSource} plus a factory that plugs it into the SAME
 * `RealtimeChannel` the browser drives.
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
 * Open one subscription over SSE, with the browser client's own recovery.
 *
 * Connects on construction and reconnects for ever until `close()`, exactly as
 * it does in a tab. `transport` is accepted and ignored: there is no socket
 * here (see {@link createSseSource}).
 */
export function createNodeChannel(options: NodeChannelOptions): RealtimeChannel {
  const { sse, ...channel } = options;
  return new RealtimeChannel({
    ...channel,
    createSource: (url) => createSseSource(url, sse),
  });
}
