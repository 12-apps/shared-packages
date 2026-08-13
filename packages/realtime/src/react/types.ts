import type { RealtimeEvent } from "../core/types";

/**
 * The browser half's shared vocabulary — kept in its own module so `connection.ts`,
 * `liveness.ts`, the worker protocol and the hooks can all name these without any
 * of them importing another's machinery.
 */

/**
 * Connection status a consumer keys its polling fallback on.
 *
 * `disconnected` and `unavailable` both mean "not receiving", and every polling seam
 * treats them identically. They differ in whether anything is still being
 * attempted: `disconnected` is between two reconnects, `unavailable` is the terminal
 * state after the initial-attempt budget — nothing further will be tried for the
 * life of this channel. Only a consumer that SHOWS the state to a person needs to
 * tell them apart, and that consumer needs to badly: one is "wait a moment", the
 * other is "reload the page".
 */
export type RealtimeStatus = "connecting" | "connected" | "disconnected" | "unavailable";

/** One event as delivered to the client: the server envelope plus its topic. */
export interface RealtimeMessage<TData = unknown>
  extends Pick<RealtimeEvent<TData>, "type" | "data" | "ts" | "id"> {
  topic: string;
}

/**
 * The minimal wire-source surface the channel drives — a seam so tests (and a future
 * transport swap) can substitute the browser's implementation.
 *
 * Deliberately the INTERSECTION of `EventSource` and `WebSocket`: `onopen`,
 * `onmessage` carrying `{ data: string }`, `onerror`, `close()`. A browser
 * `WebSocket` satisfies it natively, and so does an `EventSource`.
 */
export interface WireSource {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
  /**
   * Push a frame to the server, or `false` if it could not be sent.
   *
   * OPTIONAL on purpose. This is the one place the two wires genuinely differ in
   * capability rather than in encoding: SSE is a one-way response body and has no
   * back channel at all. Modelling it as optional makes a caller ASK —
   * `channel.canSend` — instead of discovering at runtime that its subscribe went
   * nowhere. A required method returning `false` forever would hide the asymmetry
   * behind a value that looks like a transient failure.
   */
  send?(payload: string): boolean;
}

/** Which wire a given attempt uses. */
export type RealtimeTransport = "ws" | "sse";

/** Builds the wire source, or `null` where the transport is unsupported. */
export type WireSourceFactory = (url: string, transport: RealtimeTransport) => WireSource | null;

/**
 * Where the two transports live, for a host whose mounts are not the defaults.
 *
 * The SSE stream is the subscribe URL itself, so it needs nothing here. The other
 * two are derived, and both derivations are things a host can legitimately move: the
 * ticket route sits beside the stream route (`createApiEvents` mints it at
 * `<path>/ticket`), and the gateway is a separate process that may not be on the
 * page's own origin.
 */
export interface RealtimeTransportConfig {
  /**
   * The gateway's socket endpoint WITHOUT the ticket — `wss://host/ws`.
   *
   * Default: this context's own origin with `/ws`, which is the reverse-proxy
   * arrangement. A function is re-read per attempt, so a host can point it
   * somewhere else at runtime.
   */
  socketUrl?: string | (() => string);
  /**
   * Where the ticket for a given subscribe URL is minted. Default: the path with
   * `/ticket` appended, keeping the query — the layout `createApiEvents` produces.
   */
  ticketUrl?: (subscribeUrl: string) => string;
  /** Test seam for the ticket round trip. */
  fetchTicket?: (ticketUrl: string) => Promise<string>;
}
