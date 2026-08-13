import { subscribeRealtime } from "../core/runtime";
import type { RealtimeEvent, Unsubscribe } from "../core/types";

import type { ConnectionLedger } from "./connections";

/**
 * The SSE wire for the realtime subscribe surfaces — ported verbatim from
 * future-pay's `apps/web/lib/realtime/sse.ts` (FUT-438/FUT-657). This module
 * is the ONLY place the transport is spelled out: publishers talk to topics
 * and the browser talks to the react half's `RealtimeChannel`, so swapping
 * SSE for something else touches this file and the client's connection
 * module, nothing else.
 */

/**
 * Keepalive cadence. Cloudflare severs a proxied connection that stays idle
 * for ~100s (and other middleboxes are stingier); a frame every 25s keeps
 * every hop convinced the stream is alive at negligible cost.
 */
const HEARTBEAT_MS = 25_000;

/** Reconnect delay hint sent to the browser's EventSource. */
const RETRY_HINT_MS = 3_000;

/**
 * The reserved topic control frames arrive on — the SAME name the WebSocket
 * gateway uses (`../gateway/connection.ts`), because the client must not need
 * to know which wire it is on to recognise one. `$` cannot appear in a real
 * topic: those come from `tenantTopic()` over validated segments.
 */
const GATEWAY_TOPIC = "$gateway";

/**
 * A heartbeat the CLIENT can see (FUT-657).
 *
 * This used to be `: hb`, an SSE comment. That keeps a proxy from timing the
 * connection out — the reason it existed — but a comment does not fire
 * `onmessage`, so the page's JavaScript never learned that the stream was
 * still alive. A stream that is open but delivering nothing is then
 * indistinguishable from a quiet store, and the consumer relaxes its poll on
 * the strength of `connected`, ending up staler than before realtime existed.
 *
 * A real `data:` frame keeps the proxy happy for exactly the same reason the
 * comment did, and additionally reaches the client. The topic list rides
 * along because liveness alone is not enough: a stream subscribed to the
 * wrong names heartbeats perfectly while never delivering, and the heartbeat
 * would vouch for it.
 */
function heartbeatFrame(topics: readonly string[], nowMs: number): string {
  const payload = JSON.stringify({
    topic: GATEWAY_TOPIC,
    type: "hb",
    data: { topics: [...topics] },
    ts: nowMs,
    id: `hb-${nowMs}`,
  });
  return `data: ${payload}\n\n`;
}

function frameFor(topic: string, event: RealtimeEvent): string {
  const payload = JSON.stringify({
    topic,
    type: event.type,
    data: event.data,
    ts: event.ts,
    id: event.id,
  });
  return `id: ${event.id}\ndata: ${payload}\n\n`;
}

/**
 * A controller-backed text sink that buffers until the stream attaches and
 * goes inert once closed — so a subscription handler can never throw into the
 * bus because the client left between two frames.
 */
class SseSink {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private readonly pending: string[] = [];
  private readonly encoder = new TextEncoder();
  private closed = false;
  private onAbort: (() => void) | null = null;

  /**
   * Install the cleanup to run when a write finds the stream torn down. The
   * runtime usually surfaces a vanished client through `cancel()` too, but if
   * it ever does not, a failed heartbeat would otherwise leave the bus
   * subscription, the 25s interval and the subject's cap slot leaking until
   * shutdown — so the sink triggers the (idempotent) cleanup itself.
   */
  setOnAbort(onAbort: () => void): void {
    this.onAbort = onAbort;
  }

  attach(controller: ReadableStreamDefaultController<Uint8Array>): void {
    this.controller = controller;
    for (const text of this.pending.splice(0)) this.write(text);
  }

  write(text: string): void {
    if (this.closed) return;
    if (!this.controller) {
      this.pending.push(text);
      return;
    }
    try {
      this.controller.enqueue(this.encoder.encode(text));
    } catch {
      // The stream was torn down under us (client gone) — go inert and run
      // the stream cleanup; whichever of this and cancel() fires first wins.
      this.closed = true;
      this.onAbort?.();
    }
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.controller?.close();
    } catch {
      // Already errored/cancelled — fine.
    }
  }
}

interface EventStreamOptions {
  /** Fully-qualified topic names, already authorized by the caller. */
  topics: readonly string[];
  /** Runs exactly once when the stream ends, however it ends (slot release). */
  onClose: () => void;
  /** The ledger that tracks open streams for the shutdown path. */
  streams: Pick<ConnectionLedger, "registerStreamCloser">;
}

/**
 * Subscribe to `topics` and answer an SSE `Response` that relays their events
 * until the client disconnects or the process shuts down. Cleanup — the bus
 * unsubscribes, the heartbeat timer, the caller's `onClose` — is single-shot
 * and runs on every exit path (client cancel, shutdown, subscribe failure, a
 * write that finds the client gone).
 */
export async function createEventStreamResponse(
  options: EventStreamOptions,
): Promise<Response> {
  const sink = new SseSink();
  const unsubscribes: Unsubscribe[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let deregister: (() => void) | null = null;
  let cleanedUp = false;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (heartbeat) clearInterval(heartbeat);
    deregister?.();
    for (const unsubscribe of unsubscribes.splice(0)) {
      void unsubscribe().catch(() => undefined);
    }
    sink.end();
    options.onClose();
  };
  sink.setOnAbort(cleanup);

  try {
    // Subscriptions are live BEFORE the response is returned, so an event
    // published right after the request resolves is already observed.
    for (const topic of options.topics) {
      unsubscribes.push(
        await subscribeRealtime(topic, (eventTopic, event) => {
          sink.write(frameFor(eventTopic, event));
        }),
      );
    }
  } catch (error) {
    cleanup();
    throw error;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sink.attach(controller);
      sink.write(`retry: ${RETRY_HINT_MS}\n: connected\n\n`);
      heartbeat = setInterval(
        () => sink.write(heartbeatFrame(options.topics, Date.now())),
        HEARTBEAT_MS,
      );
      deregister = options.streams.registerStreamCloser(cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-transform` keeps intermediaries (and any host-side compression)
      // from buffering the stream; `X-Accel-Buffering` is the belt-and-braces
      // for proxies that honor it.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Internals pinned by unit tests (wire format must stay stable). */
export const __testables = { frameFor, heartbeatFrame, HEARTBEAT_MS, RETRY_HINT_MS, GATEWAY_TOPIC };
