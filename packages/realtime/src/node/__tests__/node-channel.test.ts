import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNodeChannel, socketUrlFor } from "../index";
import { createWebSocketSource } from "../../react/ws-source";

/**
 * The wire a process actually gets.
 *
 * This file exists because the failure it guards is INVISIBLE from outside: a
 * consumer running on the SSE demotion reports `connected` exactly as one on
 * the socket does. The only way to tell them apart is to look at what was
 * constructed, which is what these tests do.
 */

/** A `WebSocket` stand-in: constructed, never connected, and recorded. */
function fakeSocket(opened: string[]): typeof WebSocket {
  class Fake {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    readyState = 0;
    constructor(url: string) {
      opened.push(url);
    }
    send(): void {}
    close(): void {}
  }
  return Fake as unknown as typeof WebSocket;
}

describe("socketUrlFor", () => {
  it("derives the gateway from the subscribe URL, since a process has no location", () => {
    expect(socketUrlFor("https://shop.example.com/api/admin/x/realtime?topics=kitchen")).toBe(
      "wss://shop.example.com/ws",
    );
  });

  it("drops to ws:// for a plain-http host, which is what a dev origin is", () => {
    expect(socketUrlFor("http://localhost:3002/api/admin/x/realtime")).toBe("ws://localhost:3002/ws");
  });
});

describe("createWebSocketSource outside a browser", () => {
  const sockets: string[] = [];

  beforeEach(() => {
    vi.stubGlobal("WebSocket", fakeSocket(sockets));
    sockets.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("opens a socket with no `location`, when the endpoint is named", async () => {
    // The case that was refused: Node has had a global `WebSocket` since 21 and
    // has never had `location`, so the old combined guard returned null and
    // every non-browser consumer ran on the demotion.
    expect(typeof location).toBe("undefined");
    const source = createWebSocketSource("http://host/api/realtime?topics=kitchen", {
      socketUrl: "ws://host/ws",
      fetchTicket: () => Promise.resolve("TICKET"),
    });
    expect(source).not.toBeNull();
    await vi.waitFor(() => expect(sockets).toEqual(["ws://host/ws?ticket=TICKET"]));
  });

  it("still refuses when nothing can say where the gateway is", () => {
    expect(createWebSocketSource("http://host/api/realtime")).toBeNull();
  });

  it("takes a WebSocket the host supplies, for a runtime that has none", async () => {
    // The case that matters in practice. "A recent Node has the global" is not
    // the same question as "this process does": Electron 33 bundles Node 20,
    // where it is still behind a flag. Measured on 33.4.11 — node 20.18.3,
    // `typeof WebSocket` is "undefined" — so an agent there has no socket at
    // all and silently runs on the demotion unless it can pass one in.
    vi.stubGlobal("WebSocket", undefined);
    const opened: string[] = [];
    const source = createWebSocketSource("http://host/api/realtime", {
      socketUrl: "ws://host/ws",
      fetchTicket: () => Promise.resolve("T"),
      webSocket: fakeSocket(opened),
    });
    expect(source).not.toBeNull();
    await vi.waitFor(() => expect(opened).toEqual(["ws://host/ws?ticket=T"]));
  });

  it("refuses when the runtime has none and the host supplied none", () => {
    vi.stubGlobal("WebSocket", undefined);
    expect(
      createWebSocketSource("http://host/api/realtime", { socketUrl: "ws://host/ws" }),
    ).toBeNull();
  });
});

describe("createNodeChannel", () => {
  const sockets: string[] = [];

  beforeEach(() => {
    vi.stubGlobal("WebSocket", fakeSocket(sockets));
    sockets.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("takes the SOCKET first — the wire with a client→server half", async () => {
    const tickets: string[] = [];
    const channel = createNodeChannel({
      url: "http://host/api/admin/loja/realtime?topics=kitchen",
      transport: {
        fetchTicket: (ticketUrl) => {
          tickets.push(ticketUrl);
          return Promise.resolve("T1");
        },
      },
      sse: { fetch: () => Promise.reject(new Error("the stream must not be opened here")) },
    });
    await vi.waitFor(() => expect(sockets).toEqual(["ws://host/ws?ticket=T1"]));
    // The ticket is minted at the subscribe URL's sibling, query intact.
    expect(tickets).toEqual(["http://host/api/admin/loja/realtime/ticket?topics=kitchen"]);
    channel.close();
  });

  it("defaults the gateway to the subscribe URL's own origin", async () => {
    const channel = createNodeChannel({
      url: "https://shop.example.com/api/admin/loja/realtime?topics=kitchen",
      transport: { fetchTicket: () => Promise.resolve("T2") },
    });
    await vi.waitFor(() => expect(sockets).toEqual(["wss://shop.example.com/ws?ticket=T2"]));
    channel.close();
  });

  it("lets the host override that, for a gateway on its own hostname", async () => {
    const channel = createNodeChannel({
      url: "https://shop.example.com/api/admin/loja/realtime",
      transport: {
        socketUrl: "wss://sockets.example.com/ws",
        fetchTicket: () => Promise.resolve("T3"),
      },
    });
    await vi.waitFor(() => expect(sockets).toEqual(["wss://sockets.example.com/ws?ticket=T3"]));
    channel.close();
  });
});
