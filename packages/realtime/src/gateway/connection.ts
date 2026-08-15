import { subscribeRealtime } from "../core/runtime";
import type { TicketReplayGuard } from "../core/ticket";
import type { RealtimeEvent, RealtimeLogger, Unsubscribe } from "../core/types";

import {
  INBOUND_BUCKET_CAPACITY,
  INBOUND_REFILL_PER_SECOND,
  InboundRateLimiter,
  MAX_INBOUND_BYTES,
  readInboundFrame,
  type InboundFrame,
  type InboundRejection,
} from "./inbound";

/**
 * One authorized socket: subscribe its topics, relay events, accept the client's
 * own frames, and clean up exactly once however it ends. Ported from the origin host's
 * `apps/realtime-gateway/src/connection.ts` (FUT-641/644/657).
 *
 * ## The wire frame is byte-identical to the SSE one
 *
 * `{ topic, type, data, ts, id }` — the same object `../server/sse.ts` puts in its
 * `data:` line. That is not a coincidence to preserve casually: the browser half
 * decodes with ONE function that names neither transport, so a client can switch
 * between SSE and WebSocket without a second decoder and without a flag reaching
 * any consumer. Changing this shape means changing both transports together.
 *
 * ## Control frames reuse that envelope rather than adding a second one
 *
 * A `subscribe` needs an answer, and the obvious move — a new top-level message
 * shape — would force the client to branch before decoding and would break the
 * one-decoder property above. Instead the gateway answers on a RESERVED topic
 * ({@link GATEWAY_TOPIC}), which every existing consumer already ignores: they
 * route on the topic name and treat an unknown one as nothing to do. So the
 * answers are invisible to code that does not want them and available to code that
 * does, with no change to the decoder and none to SSE.
 *
 * ## No `ws` import here
 *
 * The socket arrives through {@link GatewaySocket}, a structural subset of `ws`.
 * That keeps `ws` out of every entry that does not open one (it is an OPTIONAL
 * peer), and it is what lets the whole client→server protocol be tested against a
 * plain object instead of a real server.
 */

/** Heartbeat cadence. Also the liveness probe — see `terminate` below. */
const HEARTBEAT_MS = 25_000;

/**
 * The reserved topic control frames arrive on.
 *
 * `$` cannot appear in a real topic: those are built by `tenantTopic()` from
 * validated segments, so this namespace can never collide with a subscription.
 */
const GATEWAY_TOPIC = "$gateway";

/**
 * The socket surface this module drives — the intersection of what it needs and
 * what `ws` provides.
 *
 * Structural on purpose: `ws` is an optional peer of this package, so nothing here
 * may import it. A `WebSocket` from `ws` satisfies this natively.
 */
export interface GatewaySocket {
  send(payload: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: "message", listener: (raw: unknown) => void): unknown;
  on(event: "close" | "error" | "pong", listener: () => void): unknown;
}

/** One wire frame, as both transports render it. */
function frameFor(topic: string, event: RealtimeEvent): string {
  return JSON.stringify({
    topic,
    type: event.type,
    data: event.data,
    ts: event.ts,
    id: event.id,
  });
}

/** A control frame, in the same envelope as an event. */
function controlFrame(type: string, data: unknown, nowMs: number): string {
  return JSON.stringify({
    topic: GATEWAY_TOPIC,
    type,
    data,
    ts: nowMs,
    id: `${type}-${nowMs}`,
  });
}

/** Send, tolerating a socket that is already going away. */
function trySend(ws: GatewaySocket, payload: string): boolean {
  try {
    ws.send(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * The set of topics this socket currently receives, and the bus handles that back
 * them. Mutable for the life of the connection (FUT-644) — before that, changing
 * topics meant closing the socket and opening another.
 */
export class Subscriptions {
  private readonly handles = new Map<string, Unsubscribe>();

  constructor(private readonly onEvent: (topic: string, event: RealtimeEvent) => void) {}

  get topics(): string[] {
    return [...this.handles.keys()];
  }

  /** Subscribe to `topic` unless already held. Idempotent by name. */
  async add(topic: string): Promise<void> {
    if (this.handles.has(topic)) return;
    // Reserve the name BEFORE awaiting, so two frames racing on the same topic
    // cannot both pass the check above and leave one handle orphaned — an orphan
    // would keep delivering after an unsubscribe, which reads as a gateway that
    // ignores its client.
    this.handles.set(topic, async () => undefined);
    try {
      this.handles.set(topic, await subscribeRealtime(topic, this.onEvent));
    } catch (error) {
      this.handles.delete(topic);
      throw error;
    }
  }

  /** Drop `topic`. A name not held is not an error — see `inbound.ts`. */
  async remove(topic: string): Promise<void> {
    const handle = this.handles.get(topic);
    if (!handle) return;
    this.handles.delete(topic);
    await handle().catch(() => undefined);
  }

  async removeAll(): Promise<void> {
    const handles = [...this.handles.values()];
    this.handles.clear();
    for (const handle of handles) await handle().catch(() => undefined);
  }
}

/** Apply one admitted frame. Returns what to answer the client with. */
async function applyFrame(
  frame: InboundFrame,
  subscriptions: Subscriptions,
): Promise<{ type: string; data: unknown }> {
  switch (frame.kind) {
    case "ping":
      // The topic list rides along deliberately: it is what a client needs to
      // tell "connected and quiet" from "connected and subscribed to the wrong
      // thing", and carrying it here costs nothing (FUT-657).
      return { type: "pong", data: { topics: subscriptions.topics } };

    case "subscribe":
      for (const topic of frame.topics) await subscriptions.add(topic);
      return { type: "subscribed", data: { topics: subscriptions.topics } };

    case "unsubscribe":
      for (const topic of frame.topics) await subscriptions.remove(topic);
      return { type: "unsubscribed", data: { topics: subscriptions.topics } };
  }
}

/** Rejections that end the connection rather than merely answering it. */
const FATAL_REJECTIONS: ReadonlySet<InboundRejection> = new Set<InboundRejection>([
  "rate-limited",
]);

/** Answer a refused frame, and close if the refusal is fatal. */
function refuse(ws: GatewaySocket, reason: InboundRejection, nowMs: number): void {
  trySend(ws, controlFrame("error", { reason }, nowMs));
  // 1008 is "policy violation" — the accurate code, and one the client's
  // reconnect treats like any other close, so a rate-limited client backs off
  // rather than hammering.
  if (FATAL_REJECTIONS.has(reason)) ws.close(1008, reason);
}

export interface AttachConnectionOptions {
  ws: GatewaySocket;
  /** The topics the handshake ticket named — already verified by the caller. */
  topics: readonly string[];
  /** Runs exactly once when the connection ends, however it ends. */
  onClose: () => void;
  ticketSecret: string;
  /**
   * The single-use ledger. A mid-connection `subscribe` carries a FRESH ticket, so
   * it must be burned here too — otherwise one captured ticket could widen any
   * number of sockets for the rest of its TTL, which is the replay the handshake
   * guard closes at the other end.
   */
  replayGuard: TicketReplayGuard;
  logger: RealtimeLogger;
}

/** Wire the client→server half onto an already-subscribed socket. */
function attachInbound(
  options: AttachConnectionOptions,
  subscriptions: Subscriptions,
  onAlive: () => void,
): void {
  const { ws, ticketSecret, replayGuard, logger } = options;
  const limiter = new InboundRateLimiter(
    INBOUND_BUCKET_CAPACITY,
    INBOUND_REFILL_PER_SECOND,
    Date.now(),
  );

  ws.on("message", (raw: unknown) => {
    void (async () => {
      const now = Date.now();
      // Any inbound byte is proof the client is there, whatever it says.
      onAlive();

      const text = String(raw);
      if (text.length > MAX_INBOUND_BYTES) return refuse(ws, "malformed", now);
      if (!limiter.take(now)) return refuse(ws, "rate-limited", now);

      const result = readInboundFrame(text, ticketSecret);
      if (!result.ok) return refuse(ws, result.reason, now);

      // One ticket, one widening. Checked AFTER the signature (a forgery never
      // reaches the ledger and so cannot grow it) and only for `subscribe`, which
      // is the only verb that carries a credential.
      if (result.frame.kind === "subscribe" && !replayGuard.consume(result.frame.ticket)) {
        return refuse(ws, "replayed-ticket", now);
      }

      try {
        const answer = await applyFrame(result.frame, subscriptions);
        trySend(ws, controlFrame(answer.type, answer.data, now));
      } catch (error) {
        logger.error("inbound frame failed:", error);
        trySend(ws, controlFrame("error", { reason: "apply-failed" }, now));
      }
    })();
  });
}

export async function attachConnection(options: AttachConnectionOptions): Promise<void> {
  const { ws, topics, onClose, logger } = options;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cleanedUp = false;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (heartbeat) clearInterval(heartbeat);
    void subscriptions.removeAll();
    onClose();
  };

  const subscriptions = new Subscriptions((eventTopic, event) => {
    // A socket mid-close throws on send; the close handler is already queued, so
    // swallowing here loses nothing a re-read will not fix.
    if (!trySend(ws, frameFor(eventTopic, event))) cleanup();
  });

  ws.on("close", cleanup);
  ws.on("error", cleanup);

  try {
    // Subscriptions are live before the first frame is sent, so an event published
    // immediately after the handshake is already observed.
    for (const topic of topics) await subscriptions.add(topic);
  } catch (error) {
    logger.error("could not subscribe; closing socket:", error);
    cleanup();
    ws.close(1011, "subscribe failed");
    return;
  }

  // Liveness, not just keepalive. A client that vanished without a FIN (a tablet
  // on dying wifi — the normal case in a kitchen) leaves a socket that looks open
  // forever, holding a bus subscription and a connection slot. The pong resets the
  // flag; a missed round terminates.
  let alive = true;
  ws.on("pong", () => {
    alive = true;
  });
  heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      cleanup();
      return;
    }
    alive = false;
    ws.ping();
    // And a DATA-level heartbeat beside the protocol one (FUT-657).
    //
    // `ws.ping()` above proves the client is alive TO THE SERVER: the browser
    // answers the pong itself, at the protocol layer, and the page's JavaScript is
    // never told. So the client has no way to tell "connected and quiet" from
    // "connected and broken" — an open socket whose bus subscription failed looks
    // exactly like a calm restaurant, and the consumer relaxes its poll on that,
    // ending up staler than it was before realtime existed.
    //
    // The topic list rides along because liveness alone is not enough: a gateway
    // heartbeating perfectly while subscribed to the wrong names is still lying,
    // and the heartbeat would vouch for it. With the names, the client can check
    // what it is actually being served.
    trySend(ws, controlFrame("hb", { topics: subscriptions.topics }, Date.now()));
  }, HEARTBEAT_MS);

  attachInbound(options, subscriptions, () => {
    alive = true;
  });
}

/** Internals pinned by unit tests (the frame shape is a cross-transport contract). */
export const __testables = {
  frameFor,
  controlFrame,
  HEARTBEAT_MS,
  GATEWAY_TOPIC,
};
