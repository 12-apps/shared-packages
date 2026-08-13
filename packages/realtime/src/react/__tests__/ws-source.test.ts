import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWebSocketSource,
  defaultSocketUrl,
  socketUrlWithTicket,
  ticketUrlFor,
} from "../ws-source";

/**
 * The WebSocket wire's HANDSHAKE — the two round trips SSE does not have.
 *
 * Every case here pins where a failure LANDS, because all of them must land on
 * `onerror`: that is the single recovery path `RealtimeChannel`'s backoff and its
 * ws→sse demotion already drive, and a failure that lands anywhere else is a client
 * that silently believes it is connected. Whether the events then arrive is somebody
 * else's test; whether the browser is TOLD is this one's.
 *
 * ## Why this file drives the real module, where the component tests may not
 *
 * `connection.test.ts` injects `fakeWire()` and `web-events.test.tsx` injects
 * `createSource` — deliberately, and its fixture says why: jsdom HAS `WebSocket` but
 * NOT `EventSource`, so a channel mounted with the real default factory takes the
 * SOCKET path and genuinely `POST`s for a ticket. A component test that let that
 * happen would be making network calls to prove a rendering claim.
 *
 * The consequence is that nothing exercised `createWebSocketSource`,
 * `fetchRealtimeTicket` or the socket URL derivation at all — and the browser harness
 * asserts only DELIVERY, which a silent ws→sse demotion still satisfies. So this file
 * takes the opposite trade on purpose: it owns the whole environment the module reads
 * (`WebSocket`, `location`, `fetch` are all stubbed per case, and nothing here renders
 * a component), which makes the real handshake the thing under test rather than a side
 * effect of one.
 *
 * Node environment, not jsdom, for the same reason: the module needs three globals and
 * no DOM, and stubbing `location` is unobstructed where jsdom does not already own it.
 */

/** A `WebSocket` stand-in, recording every socket the module opened and with what. */
function fakeSockets() {
  const opened: FakeSocket[] = [];

  class FakeSocket {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    closed = false;

    constructor(readonly url: string) {
      opened.push(this);
    }

    close(): void {
      this.closed = true;
    }
  }

  return {
    opened,
    /** Install it as the engine's `WebSocket`. */
    install: (): void => {
      vi.stubGlobal("WebSocket", FakeSocket);
    },
    last: (): FakeSocket => {
      const socket = opened.at(-1);
      if (!socket) throw new Error("no socket was opened");
      return socket;
    },
  };
}

/** The ticket endpoint answering, as `fetch` sees it. */
function ticketReturns(ticket: string): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: { ticket } }),
  });
}

/**
 * Drain the microtask queue.
 *
 * The handshake is a chain of promises with no scheduled work (`fetch` → `json` →
 * `new WebSocket`), so draining is exact where a timer would be a guess — the same
 * reasoning `shared-channel.test.ts` uses.
 */
async function settle(): Promise<void> {
  for (let drain = 0; drain < 25; drain += 1) await Promise.resolve();
}

const SUBSCRIBE_URL = "/api/admin/loja-a/realtime?topics=kitchen";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ticketUrlFor", () => {
  it("inserts /ticket before the query, keeping the topics", () => {
    // The topics have to survive: the ticket is signed FOR them, so a mint that lost
    // the query would authorize a subscription to nothing.
    expect(ticketUrlFor("/api/admin/loja-a/realtime?topics=kitchen:s1,kitchen:unassigned")).toBe(
      "/api/admin/loja-a/realtime/ticket?topics=kitchen:s1,kitchen:unassigned",
    );
  });

  it("handles a URL with no query at all", () => {
    expect(ticketUrlFor("/api/account/realtime")).toBe("/api/account/realtime/ticket");
  });
});

describe("defaultSocketUrl / socketUrlWithTicket", () => {
  it("reads `location`, not `window.location`, and picks the matching scheme", () => {
    // `window` does not exist inside a SharedWorker at all. Reading it through
    // `window` failed the capability check rather than throwing, so the worker
    // quietly served every tab over SSE — a WebSocket switched off by accident.
    vi.stubGlobal("location", { protocol: "https:", host: "shop.example" });
    expect(defaultSocketUrl()).toBe("wss://shop.example/ws");
    vi.stubGlobal("location", { protocol: "http:", host: "localhost:3000" });
    expect(defaultSocketUrl()).toBe("ws://localhost:3000/ws");
  });

  it("encodes the ticket and respects a query the gateway endpoint already has", () => {
    // A ticket is base64url + ".", but encoding is what keeps a future format change
    // from silently truncating at the first "&".
    expect(socketUrlWithTicket("wss://shop.example/ws", "abc.def")).toBe(
      "wss://shop.example/ws?ticket=abc.def",
    );
    expect(socketUrlWithTicket("wss://gw.example/ws?region=sa", "a+b/c=")).toBe(
      "wss://gw.example/ws?region=sa&ticket=a%2Bb%2Fc%3D",
    );
  });
});

describe("createWebSocketSource", () => {
  const sockets = { current: fakeSockets() };

  beforeEach(() => {
    sockets.current = fakeSockets();
    sockets.current.install();
    vi.stubGlobal("location", { protocol: "https:", host: "shop.example" });
  });

  it("mints a ticket, then opens the socket with it", async () => {
    const fetchTicket = ticketReturns("signed-ticket");
    vi.stubGlobal("fetch", fetchTicket);

    const source = createWebSocketSource(SUBSCRIBE_URL);
    await settle();

    // Two round trips, in this order: the ticket request is the authenticated half
    // (the socket is served by a process with no session), so it carries the cookie.
    expect(fetchTicket).toHaveBeenCalledWith(
      "/api/admin/loja-a/realtime/ticket?topics=kitchen",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(sockets.current.last().url).toBe("wss://shop.example/ws?ticket=signed-ticket");
    source?.close();
  });

  it("opens at the gateway the host configured, re-read per attempt", async () => {
    vi.stubGlobal("fetch", ticketReturns("t"));

    const source = createWebSocketSource(SUBSCRIBE_URL, {
      socketUrl: () => "wss://gateway.example/ws",
    });
    await settle();

    // The gateway is a separate process and need not be on the page's own origin.
    expect(sockets.current.last().url).toBe("wss://gateway.example/ws?ticket=t");
    source?.close();
  });

  it("reports a refused ticket through onerror, not silence", async () => {
    // 401/403/503 all mean "no socket here" to a client. Landing on onerror is what
    // lets the channel count the attempt, demote to SSE and keep polling.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const source = createWebSocketSource(SUBSCRIBE_URL);
    const failures: unknown[] = [];
    if (source) source.onerror = (event) => failures.push(event);
    await settle();

    expect(failures).toHaveLength(1);
    expect(sockets.current.opened).toEqual([]);
  });

  it("reports a network failure on the ticket request through onerror", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const source = createWebSocketSource(SUBSCRIBE_URL);
    const failures: unknown[] = [];
    if (source) source.onerror = (event) => failures.push(event);
    await settle();

    expect(failures).toHaveLength(1);
    expect(sockets.current.opened).toEqual([]);
  });

  it("reports a ticket response that carried no ticket", async () => {
    // A 200 with the wrong body is the one shape that could pass for success and
    // open a socket with `ticket=undefined`.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ data: {} }) }),
    );
    const source = createWebSocketSource(SUBSCRIBE_URL);
    const failures: unknown[] = [];
    if (source) source.onerror = (event) => failures.push(event);
    await settle();

    expect(failures).toHaveLength(1);
    expect(sockets.current.opened).toEqual([]);
  });

  it("treats a socket CLOSE as an error, so one recovery path serves both transports", async () => {
    vi.stubGlobal("fetch", ticketReturns("t"));
    const source = createWebSocketSource(SUBSCRIBE_URL);
    const failures: unknown[] = [];
    if (source) source.onerror = (event) => failures.push(event);
    await settle();

    // A clean server close (a deploy, a `stop_grace_period`) reaches `onclose`, which
    // the channel has no concept of — unmapped, the client would sit there believing
    // it was still connected while nothing arrived.
    sockets.current.last().onclose?.({});
    expect(failures).toHaveLength(1);
    source?.close();
  });

  it("does not open a socket if the consumer closed during the round trip", async () => {
    vi.stubGlobal("fetch", ticketReturns("t"));
    const source = createWebSocketSource(SUBSCRIBE_URL);

    // Unmounted mid-handshake — a route change, a tenant switch. A socket opened now
    // is one nothing will ever close.
    source?.close();
    await settle();

    expect(sockets.current.opened).toEqual([]);
  });

  it("stays silent after close, so a late failure cannot reconnect a dead channel", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const source = createWebSocketSource(SUBSCRIBE_URL);
    const failures: unknown[] = [];
    if (source) source.onerror = (event) => failures.push(event);
    source?.close();
    await settle();

    // The channel already reported `disconnected` and cancelled its retry; an
    // `onerror` arriving from the abandoned handshake would arm a new one.
    expect(failures).toEqual([]);
  });

  it("answers null where the engine has no WebSocket, so SSE can take over", () => {
    vi.stubGlobal("WebSocket", undefined);
    // Knowable BEFORE a connection is attempted, so it costs no failed attempt out of
    // the channel's initial budget — unlike the ws→sse demotion, which does.
    expect(createWebSocketSource(SUBSCRIBE_URL)).toBeNull();
  });

  it("answers null under SSR, where there is no `location` to derive from", () => {
    vi.stubGlobal("location", undefined);
    expect(createWebSocketSource(SUBSCRIBE_URL)).toBeNull();
  });
});
