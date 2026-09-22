import type { WireSource } from "../react/types";

import { SseDecoder } from "./sse-decoder";

/**
 * An SSE {@link WireSource} for a runtime that has `fetch` but no `EventSource`
 * — Node, and an Electron MAIN process.
 *
 * ## Why this is the whole of the node client
 *
 * `RealtimeChannel` (`../react/connection.ts`) is already framework-free: the
 * reconnect with jittered backoff, the demotion, the silence watch and the
 * heartbeat reading are all plain TypeScript behind ONE seam — `createSource`.
 * The only thing a browser was supplying that a server runtime cannot is the
 * `EventSource` constructor. So the node half of this package is not a second
 * client; it is that constructor, and every behaviour a consumer depends on
 * stays the one the browser half was measured with.
 *
 * ## It answers for BOTH wires, on purpose
 *
 * The channel starts on `ws` and demotes to `sse` after a failed attempt. This
 * factory ignores that distinction and serves the event stream either way,
 * which costs the demotion attempt rather than paying it:
 *
 *   - a socket needs a TICKET, minted by an authenticated round trip, and this
 *     runtime's whole reason for existing is that it already holds a session;
 *   - a background process holds ONE subscription for its whole life, so the
 *     back channel a socket buys — widening topics without reconnecting — has
 *     no caller here.
 *
 * Returning `null` for `ws` would be the other way to say this and is WRONG:
 * `null` means "no transport in this runtime", which the channel treats as
 * terminal (`unavailable`) rather than trying the next wire.
 *
 * ## Credentials are the caller's

 * Nothing here reads a cookie jar or a token. The `fetch` is injected, so an
 * Electron host passes `net.fetch` bound to the session its login window filled
 * and the cookies ride automatically; a server-to-server consumer passes a
 * plain `fetch` and its own `Authorization` header. This module never learns
 * which, which is what keeps the authorization story in one place.
 */
export interface SseSourceOptions {
  /**
   * The fetch to open the stream with. Defaults to the global.
   *
   * The seam that carries IDENTITY — see the docblock. Also the test seam: a
   * unit test hands back a stream it writes into by hand.
   */
  fetch?: typeof globalThis.fetch;
  /** Extra request headers. `accept` is set here and cannot be overridden. */
  headers?: Readonly<Record<string, string>>;
}

/**
 * What a stream must answer with before it counts as open.
 *
 * A proxy that lost the upstream, a login page served to an expired session, a
 * captive portal — each answers 200 with HTML, and a client that took the
 * status alone for success reports `connected` and then sits silent for ever.
 * The silence watch would eventually catch it; refusing it here costs one
 * reconnect instead of 75 seconds of a consumer believing it is live.
 */
const STREAM_CONTENT_TYPE = "text/event-stream";

export function createSseSource(url: string, options: SseSourceOptions = {}): WireSource {
  const doFetch = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const decoder = new SseDecoder();
  let closed = false;

  const source: WireSource = {
    onopen: null,
    onmessage: null,
    onerror: null,
    close(): void {
      if (closed) return;
      closed = true;
      controller.abort();
    },
    // `send` is deliberately ABSENT rather than a method returning false: the
    // channel's `canSend` asks whether the property is a function, and a
    // consumer that needs a back channel should see "no" rather than discover
    // it one dropped frame at a time. See `WireSource`.
  };

  /**
   * Report a drop ONCE, and only while the caller still wants one.
   *
   * Every ending arrives here — a refusal, a socket reset, a server that closed
   * the response cleanly, our own `close()` — because the channel's recovery is
   * the same in every case. The `closed` guard is what stops a deliberate
   * `close()` from waking the reconnect the channel has just cancelled.
   */
  const fail = (): void => {
    if (closed) return;
    closed = true;
    source.onerror?.(new Error("realtime stream ended"));
  };

  void (async (): Promise<void> => {
    let response: Response;
    try {
      response = await doFetch(url, {
        signal: controller.signal,
        headers: { ...options.headers, accept: STREAM_CONTENT_TYPE },
      });
    } catch {
      // Includes the abort our own `close()` raises, which `fail` then drops.
      fail();
      return;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes(STREAM_CONTENT_TYPE) || !response.body) {
      // Drain nothing and let the body be collected: the connection is being
      // abandoned, and reading a login page into memory helps no one.
      controller.abort();
      fail();
      return;
    }
    if (closed) return;
    source.onopen?.(response);

    const reader = response.body.getReader();
    const text = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // `stream: true` holds a multi-byte character that a chunk split in
        // half — an accented word in a ticket is exactly that — rather than
        // emitting a replacement character into the JSON.
        for (const payload of decoder.push(text.decode(value, { stream: true }))) {
          if (closed) return;
          source.onmessage?.({ data: payload });
        }
      }
    } catch {
      // A reset mid-stream. Same recovery as every other ending.
    } finally {
      decoder.reset();
    }
    // Reached on a CLEAN end too, and that is not a success: this wire has no
    // "the server is done" state — a subscription that ends is a subscription
    // that dropped, and the channel's job is to open another one.
    fail();
  })();

  return source;
}
