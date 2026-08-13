import {
  CONTROL_TOPIC,
  heartbeatProvesBroken,
  readHeartbeat,
  readServedTopics,
  SILENCE_CHECK_MS,
  SILENCE_LIMIT_MS,
  SilenceWatch,
} from "./liveness";
import type {
  RealtimeMessage,
  RealtimeStatus,
  RealtimeTransport,
  RealtimeTransportConfig,
  WireSource,
  WireSourceFactory,
} from "./types";
import { createWebSocketSource } from "./ws-source";

/**
 * The browser side of the realtime channel (FUT-438): a long-lived subscription to a
 * set of event topics, with automatic reconnection and an observable status.
 *
 * ## The fallback contract every consumer builds on
 *
 * Realtime is a LATENCY OPTIMISATION over polling, never a replacement. Consumers
 * keep their `refetchInterval` and relax it only while `status === "connected"` (see
 * `reconcileRefetchInterval`); every received message is a hint to RE-READ
 * (invalidate the matching query), not the data itself. So a dead stream, a proxy
 * that strips it, or a browser without the transport all degrade to plain polling —
 * no surface may regress when realtime is down.
 *
 * The wire transport is an implementation detail of this module: nothing in the
 * public surface names it, so it can change server-side and here without touching a
 * consumer.
 */

/** First reconnect delay; doubles per failed attempt up to the max. */
const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

/**
 * How many times to try an endpoint that has NEVER connected before giving up.
 *
 * The distinction is never-worked vs stopped-working, and only the second is worth
 * retrying forever. A deployment with no realtime driver answers 503 to every attempt
 * for the life of the process, and `EventSource` cannot read a status code — so an
 * unbounded backoff turns "realtime is off here" into an endless line of failed
 * requests in every tab, for a stream that was only ever an accelerator over polling.
 *
 * A channel that has connected at least once keeps reconnecting indefinitely: that is
 * the deploy-restart case.
 */
const MAX_INITIAL_ATTEMPTS = 4;

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
function makeDefaultSourceFactory(
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

/**
 * What a client may push. Mirrors the gateway's closed verb set in
 * `../gateway/inbound.ts`; anything else is refused there.
 */
export type OutboundFrame =
  /** Widen the subscription. The topics come from the SIGNED ticket, not here. */
  | { type: "subscribe"; ticket: string }
  /** Narrow it. Needs no ticket — dropping a topic discloses nothing. */
  | { type: "unsubscribe"; topics: readonly string[] }
  /** Presence, answered with the topic list the gateway believes it serves. */
  | { type: "ping" };

export interface RealtimeChannelOptions {
  /** The subscribe endpoint URL, query included. */
  url: string;
  /** Called once per received event. */
  onMessage?: (message: RealtimeMessage) => void;
  /** Called on every status transition (including the initial "connecting"). */
  onStatusChange?: (status: RealtimeStatus) => void;
  /**
   * The RESOLVED topic names the server says it is serving, every time it says so
   * (FUT-659). A consumer that owns a mutable subscription needs them: `unsubscribe`
   * names topics in the server's spelling, and this is the only place the client
   * learns it.
   */
  onServedTopics?: (topics: readonly string[]) => void;
  /** Where the ws/ticket endpoints live, when they are not the defaults. */
  transport?: RealtimeTransportConfig;
  /** Test/transport seam; defaults to the browser's implementation. */
  createSource?: WireSourceFactory;
  /**
   * Randomness for the reconnect jitter. Injected so a test can pin the delay; app
   * code leaves it alone.
   */
  random?: () => number;
}

/** Parse one wire payload, or `null` for anything malformed. */
function decodeMessage(raw: string): RealtimeMessage | null {
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

/**
 * One realtime subscription. Connects on construction, reconnects with exponential
 * backoff (1s → 2s → … → 30s cap, reset on a successful open), and reports
 * `disconnected` the moment the stream drops — which is the signal consumers use to
 * keep polling.
 */
export class RealtimeChannel {
  private readonly createSource: WireSourceFactory;
  private readonly random: () => number;
  private source: WireSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = INITIAL_RETRY_MS;
  private currentStatus: RealtimeStatus = "connecting";
  private closed = false;
  /** Whether this channel has ever opened — see {@link MAX_INITIAL_ATTEMPTS}. */
  private everConnected = false;
  private failedAttempts = 0;
  /**
   * The wire this channel is currently attempting. Starts on `ws` and demotes to
   * `sse` once — permanently for this channel's life — see {@link handleDrop}.
   */
  private transport: RealtimeTransport = "ws";
  /** Watches for a channel that is open and saying nothing (FUT-657). */
  private readonly silence = new SilenceWatch(
    () => {
      // Deliberately the SAME path as a real drop: reconnecting is how a channel
      // recovers, and a silent one has nothing better to try.
      this.handleDrop();
    },
    () => !this.closed && this.currentStatus === "connected",
  );

  constructor(private readonly options: RealtimeChannelOptions) {
    this.createSource = options.createSource ?? makeDefaultSourceFactory(options.transport);
    this.random = options.random ?? Math.random;
    options.onStatusChange?.(this.currentStatus);
    this.connect();
  }

  /** The current status — also pushed through `onStatusChange`. */
  get status(): RealtimeStatus {
    return this.currentStatus;
  }

  /**
   * Whether this channel has a client→server half at all (FUT-644).
   *
   * `false` on SSE, and on a WebSocket that is not open yet. A caller that needs to
   * widen a subscription must branch on this rather than assume: on SSE the only way
   * to change topics is still to open a new channel.
   */
  get canSend(): boolean {
    return typeof this.source?.send === "function";
  }

  /**
   * Push one frame. `false` means it did not go — no wire, wrong wire, or a socket
   * that is closing — and the caller keeps whatever fallback it had.
   *
   * Deliberately NOT queued for a later reconnect. Every verb here is about the
   * subscription of THIS connection: a `subscribe` replayed onto a socket that
   * reconnected in between would arrive after the handshake already restored the
   * topics, and a stale ticket would be refused anyway. Dropping it is correct, and
   * the reconnect path is what restores state.
   */
  send(frame: OutboundFrame): boolean {
    if (this.closed) return false;
    const send = this.source?.send;
    if (!send || !this.source) return false;
    try {
      return send.call(this.source, JSON.stringify(frame));
    } catch {
      return false;
    }
  }

  /** Stop for good: closes the stream and cancels any pending reconnect. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.silence.stop();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.source?.close();
    this.source = null;
    this.setStatus("disconnected");
  }

  /**
   * A control frame — the heartbeat, plus the subscribe/unsubscribe acks.
   *
   * A heartbeat that reports no topics is treated as a drop: whatever that server is
   * doing, it is not serving this subscription.
   */
  private readControl(message: RealtimeMessage): void {
    const served = readServedTopics(message);
    if (served) this.options.onServedTopics?.(served);
    // Read separately, and only from the heartbeat: an `unsubscribed` answer
    // reporting zero topics is a client that just dropped its last one, which is
    // correct behaviour, not a broken channel.
    const beat = readHeartbeat(message);
    if (beat && heartbeatProvesBroken(beat)) this.handleDrop();
  }

  private setStatus(next: RealtimeStatus): void {
    if (this.currentStatus === next) return;
    this.currentStatus = next;
    this.options.onStatusChange?.(next);
  }

  private connect(): void {
    if (this.closed) return;
    const source = this.createSource(this.options.url, this.transport);
    if (!source) {
      // No transport here (SSR, unsupported browser, a test env that removed the
      // globals). Terminal for the same reason as the give-up path below — nothing is
      // scheduled to change it — so it reports `unavailable`, and the consumer's
      // polling fallback simply keeps running.
      this.setStatus("unavailable");
      return;
    }
    this.source = source;
    source.onopen = () => {
      this.retryMs = INITIAL_RETRY_MS;
      this.failedAttempts = 0;
      this.everConnected = true;
      this.silence.start(Date.now());
      this.setStatus("connected");
    };
    source.onmessage = (event) => {
      const message = decodeMessage(event.data);
      if (!message) return;
      this.silence.note(Date.now());
      // Control frames are not events. Forwarding them would hand every consumer a
      // message every 25 s that none of them route anywhere — the topic is unknown to
      // all of them by construction, so it would be pure noise with a chance of being
      // mistaken for a hint.
      if (message.topic === CONTROL_TOPIC) {
        this.readControl(message);
        return;
      }
      this.options.onMessage?.(message);
    };
    source.onerror = () => this.handleDrop();
  }

  /**
   * The next reconnect delay: exponential backoff with FULL-RANGE-HALF JITTER.
   *
   * The backoff alone is not enough, and the failure it misses is the one that hurts
   * most. Everything drops at the SAME INSTANT when a gateway restarts or a proxy
   * recycles — every tab, of every device, of every store — so a fixed 1s first retry
   * means the whole fleet arrives together, is refused together (the process is still
   * booting), waits 2s together, and keeps marching in lockstep. The backoff spaces
   * one client's attempts; the jitter is what spaces DIFFERENT clients from each
   * other, which is the actual thundering herd. The SharedWorker collapses a single
   * person's tabs and does nothing for the fleet.
   *
   * Half-range rather than full: the delay stays in [d/2, d], so the documented
   * ceiling still means something and a recovering client is never pushed to twice
   * its stated wait.
   */
  private nextDelayMs(): number {
    const jittered = this.retryMs / 2 + this.random() * (this.retryMs / 2);
    return Math.round(jittered);
  }

  private handleDrop(): void {
    if (this.closed) return;
    // Take over reconnection entirely (rather than trusting the transport's own
    // retry): one owner for backoff means the status a consumer sees and the actual
    // connection attempts can never disagree.
    this.silence.stop();
    this.source?.close();
    this.source = null;
    this.setStatus("disconnected");

    // The WebSocket never opened, so demote to SSE and start over there.
    //
    // This is what makes shipping the socket ON safe, and it replaces the build flag
    // that used to guard it. A gateway that is missing, unreachable, or fronted by a
    // proxy that will not pass an upgrade is invisible from here: the browser reports
    // a `close` with no status code either way. So the only sound signal is "the
    // socket did not open", and the only sound response is to try the wire that has
    // no such dependency rather than to keep retrying this one.
    //
    // Gated on `everConnected` so it is strictly a never-worked path: a socket that
    // HAS opened stays on `ws` and reconnects there forever, because that is the
    // deploy-restart case, where the gateway is coming back.
    //
    // One-way and once: SSE is fully functional, so a demoted channel is degraded in
    // no way a consumer can observe. A fresh page load tries `ws` again.
    if (this.transport === "ws" && !this.everConnected) {
      this.transport = "sse";
      this.retryMs = INITIAL_RETRY_MS;
      // SSE gets the full initial-attempt budget: the ws failures said nothing about
      // whether the SSE endpoint serves here, and spending part of its budget on
      // another wire's verdict is how a working stream gets skipped.
      this.failedAttempts = 0;
      this.setStatus("connecting");
      this.connect();
      return;
    }

    // Never connected, and out of patience: this endpoint is not serving here. Staying
    // degraded is the documented mode — every consumer keeps its polling fallback —
    // whereas retrying forever only fills the network log with a failure nobody can
    // act on from the browser.
    //
    // The state is `unavailable` rather than `disconnected` because it is TERMINAL: no
    // timer is armed and nothing will change it. A screen showing "reconnecting…"
    // here would be lying about work that is not happening.
    this.failedAttempts += 1;
    if (!this.everConnected && this.failedAttempts >= MAX_INITIAL_ATTEMPTS) {
      this.setStatus("unavailable");
      return;
    }

    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.setStatus("connecting");
      this.connect();
    }, this.nextDelayMs());
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }
}

/** Internals pinned by unit tests (the backoff shape is a documented contract). */
export const __testables = {
  SILENCE_LIMIT_MS,
  SILENCE_CHECK_MS,
  CONTROL_TOPIC,
  INITIAL_RETRY_MS,
  MAX_RETRY_MS,
  MAX_INITIAL_ATTEMPTS,
  decodeMessage,
};
