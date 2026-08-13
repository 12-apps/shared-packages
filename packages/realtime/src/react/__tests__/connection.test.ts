import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeChannel, __testables } from "../connection";
import type { RealtimeMessage, RealtimeStatus, RealtimeTransport, WireSource } from "../types";

/**
 * The reconnect policy, the ws→sse demotion and the liveness watch.
 *
 * All three are the SAME mechanism from a consumer's point of view — "is this channel
 * live?" — and all three have a way of lying: a channel that reports `connected` while
 * delivering nothing, one that retries forever against a wire that cannot work, and one
 * whose whole fleet reconnects in lockstep after a gateway restart.
 */

const { INITIAL_RETRY_MS, MAX_RETRY_MS, MAX_INITIAL_ATTEMPTS, CONTROL_TOPIC, SILENCE_LIMIT_MS } =
  __testables;

/** A fake wire, and a record of how many were built and on which transport. */
function fakeWire() {
  const built: { url: string; transport: RealtimeTransport; source: FakeSource }[] = [];

  class FakeSource implements WireSource {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    closed = false;
    readonly sent: string[] = [];

    close(): void {
      this.closed = true;
    }
  }

  /** A source WITH a back channel — the WebSocket shape. */
  class FakeSocket extends FakeSource {
    send(payload: string): boolean {
      this.sent.push(payload);
      return true;
    }
  }

  return {
    built,
    /** Both wires available. */
    factory: (url: string, transport: RealtimeTransport): WireSource => {
      const source = transport === "ws" ? new FakeSocket() : new FakeSource();
      built.push({ url, transport, source });
      return source;
    },
    /** No transport at all — the jsdom/SSR case. */
    nothing: (): null => null,
    latest: (): FakeSource => {
      const last = built.at(-1);
      if (!last) throw new Error("no source built");
      return last.source;
    },
  };
}

/** Drive the wire, not the user: a transport callback is the wire firing. */
function goLive(source: WireSource): void {
  source.onopen?.({});
}
function drop(source: WireSource): void {
  source.onerror?.({});
}
function deliver(source: WireSource, message: RealtimeMessage): void {
  source.onmessage?.({ data: JSON.stringify(message) });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RealtimeChannel — status transitions", () => {
  it("announces connecting on construction and connected on open", () => {
    const wire = fakeWire();
    const seen: RealtimeStatus[] = [];
    new RealtimeChannel({
      url: "/api/r?topics=kitchen",
      createSource: wire.factory,
      onStatusChange: (status) => seen.push(status),
    });
    goLive(wire.latest());
    expect(seen).toEqual(["connecting", "connected"]);
  });

  it("reports unavailable — terminal, no timer — when there is no transport at all", () => {
    // jsdom removes EventSource/WebSocket, so this is the state every SPA test suite
    // runs in: TERMINAL, so no retry and no request. Consumers keep their full poll.
    const seen: RealtimeStatus[] = [];
    new RealtimeChannel({
      url: "/api/r",
      createSource: () => null,
      onStatusChange: (status) => seen.push(status),
    });
    expect(seen).toEqual(["connecting", "unavailable"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards events but never control frames", () => {
    const wire = fakeWire();
    const received: RealtimeMessage[] = [];
    new RealtimeChannel({
      url: "/api/r",
      createSource: wire.factory,
      onMessage: (message) => received.push(message),
    });
    goLive(wire.latest());
    deliver(wire.latest(), {
      topic: CONTROL_TOPIC,
      type: "hb",
      data: { topics: ["tenant:t-1:kitchen"] },
      ts: 1,
      id: "hb-1",
    });
    deliver(wire.latest(), {
      topic: "tenant:t-1:kitchen",
      type: "kitchen.changed",
      data: {},
      ts: 2,
      id: "e-1",
    });
    // A heartbeat every 25s that no consumer routes anywhere would be pure noise with a
    // chance of being mistaken for a hint.
    expect(received.map((message) => message.type)).toEqual(["kitchen.changed"]);
  });

  it("reports the served topic list off any control frame that carries one", () => {
    const wire = fakeWire();
    const served: readonly string[][] = [];
    const record = (topics: readonly string[]): void => {
      (served as string[][]).push([...topics]);
    };
    new RealtimeChannel({ url: "/api/r", createSource: wire.factory, onServedTopics: record });
    goLive(wire.latest());
    deliver(wire.latest(), {
      topic: CONTROL_TOPIC,
      type: "subscribed",
      data: { topics: ["tenant:t-1:kitchen"] },
      ts: 1,
      id: "s-1",
    });
    expect(served).toEqual([["tenant:t-1:kitchen"]]);
  });
});

describe("RealtimeChannel — the ws→sse demotion", () => {
  it("starts on ws and demotes to sse once, when the socket never opened", () => {
    const wire = fakeWire();
    new RealtimeChannel({ url: "/api/r", createSource: wire.factory });
    expect(wire.built[0]?.transport).toBe("ws");
    drop(wire.latest());
    // Immediate, not after a backoff: the ws failures said nothing about whether SSE
    // serves here, and spending part of its budget on another wire's verdict is how a
    // working stream gets skipped.
    expect(wire.built[1]?.transport).toBe("sse");
  });

  it("stays on ws once the socket HAS opened — that is the deploy-restart case", () => {
    const wire = fakeWire();
    new RealtimeChannel({ url: "/api/r", createSource: wire.factory, random: () => 1 });
    goLive(wire.latest());
    drop(wire.latest());
    vi.advanceTimersByTime(INITIAL_RETRY_MS);
    expect(wire.built.map((entry) => entry.transport)).toEqual(["ws", "ws"]);
  });
});

describe("RealtimeChannel — the initial-attempt budget", () => {
  it("gives up on an endpoint that never worked, and goes terminal", () => {
    const wire = fakeWire();
    const seen: RealtimeStatus[] = [];
    new RealtimeChannel({
      url: "/api/r",
      createSource: wire.factory,
      onStatusChange: (status) => seen.push(status),
      random: () => 1,
    });
    // The first drop DEMOTES rather than spending an attempt — SSE gets the full budget,
    // because the ws failures said nothing about whether the SSE endpoint serves here.
    drop(wire.latest());
    expect(wire.built.at(-1)?.transport).toBe("sse");
    for (let attempt = 0; attempt < MAX_INITIAL_ATTEMPTS; attempt += 1) {
      drop(wire.latest());
      vi.advanceTimersByTime(MAX_RETRY_MS);
    }
    // `unavailable` rather than `disconnected` because nothing is armed: a screen showing
    // "reconnecting…" here would be lying about work that is not happening.
    expect(seen.at(-1)).toBe("unavailable");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reconnects indefinitely once it has connected at least once", () => {
    const wire = fakeWire();
    new RealtimeChannel({ url: "/api/r", createSource: wire.factory, random: () => 1 });
    goLive(wire.latest());
    for (let round = 0; round < MAX_INITIAL_ATTEMPTS + 3; round += 1) {
      drop(wire.latest());
      vi.advanceTimersByTime(MAX_RETRY_MS);
    }
    expect(wire.built.length).toBeGreaterThan(MAX_INITIAL_ATTEMPTS + 1);
  });
});

describe("RealtimeChannel — reconnect storms", () => {
  it("jitters the delay into the lower half of the backoff window", () => {
    // The failure the backoff alone misses: EVERYTHING drops at the same instant when a
    // gateway restarts, so a fixed first retry marches the whole fleet in lockstep. The
    // backoff spaces one client's attempts; the jitter spaces different clients.
    const wire = fakeWire();
    new RealtimeChannel({
      url: "/api/r",
      createSource: wire.factory,
      random: () => 0,
      // Opened once, so the demotion is off the table and the retry is a plain backoff.
    });
    goLive(wire.latest());
    drop(wire.latest());

    // random() === 0 puts the delay at HALF the nominal backoff. Just before it, nothing.
    vi.advanceTimersByTime(INITIAL_RETRY_MS / 2 - 1);
    expect(wire.built).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(wire.built).toHaveLength(2);
  });

  it("never exceeds the nominal backoff, so the documented ceiling still holds", () => {
    const wire = fakeWire();
    new RealtimeChannel({ url: "/api/r", createSource: wire.factory, random: () => 1 });
    goLive(wire.latest());
    drop(wire.latest());
    // random() === 1 is the top of the window: exactly the nominal delay, never more.
    vi.advanceTimersByTime(INITIAL_RETRY_MS);
    expect(wire.built).toHaveLength(2);
  });

  it("doubles the window per failed attempt and caps it", () => {
    const wire = fakeWire();
    new RealtimeChannel({ url: "/api/r", createSource: wire.factory, random: () => 1 });
    goLive(wire.latest());

    drop(wire.latest());
    vi.advanceTimersByTime(INITIAL_RETRY_MS);
    expect(wire.built).toHaveLength(2);

    drop(wire.latest());
    vi.advanceTimersByTime(INITIAL_RETRY_MS * 2 - 1);
    expect(wire.built).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(wire.built).toHaveLength(3);
  });

  it("resets the window after a successful open", () => {
    const wire = fakeWire();
    new RealtimeChannel({ url: "/api/r", createSource: wire.factory, random: () => 1 });
    goLive(wire.latest());
    drop(wire.latest());
    vi.advanceTimersByTime(INITIAL_RETRY_MS);
    goLive(wire.latest());
    drop(wire.latest());
    vi.advanceTimersByTime(INITIAL_RETRY_MS);
    expect(wire.built).toHaveLength(3);
  });
});

describe("RealtimeChannel — a channel that is open and lying", () => {
  it("treats a heartbeat reporting ZERO topics as a drop", () => {
    const wire = fakeWire();
    const seen: RealtimeStatus[] = [];
    new RealtimeChannel({
      url: "/api/r",
      createSource: wire.factory,
      onStatusChange: (status) => seen.push(status),
      random: () => 1,
    });
    goLive(wire.latest());
    // Whatever that server is doing, it is not serving this subscription — and the
    // consumer has already relaxed its poll on the strength of `connected`.
    deliver(wire.latest(), {
      topic: CONTROL_TOPIC,
      type: "hb",
      data: { topics: [] },
      ts: 1,
      id: "hb-1",
    });
    expect(seen).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("does NOT treat an `unsubscribed` answer reporting zero topics as a drop", () => {
    const wire = fakeWire();
    const seen: RealtimeStatus[] = [];
    new RealtimeChannel({
      url: "/api/r",
      createSource: wire.factory,
      onStatusChange: (status) => seen.push(status),
    });
    goLive(wire.latest());
    // A client that just dropped its last topic is correct behaviour, not a broken
    // channel.
    deliver(wire.latest(), {
      topic: CONTROL_TOPIC,
      type: "unsubscribed",
      data: { topics: [] },
      ts: 1,
      id: "u-1",
    });
    expect(seen).toEqual(["connecting", "connected"]);
  });

  it("reconnects a channel that has heard nothing for too long", () => {
    const wire = fakeWire();
    const seen: RealtimeStatus[] = [];
    new RealtimeChannel({
      url: "/api/r",
      createSource: wire.factory,
      onStatusChange: (status) => seen.push(status),
      random: () => 1,
    });
    goLive(wire.latest());
    // Three heartbeats' worth of silence: nothing FAILED, so no retry anywhere would
    // have helped — the only evidence is the absence of an event.
    vi.advanceTimersByTime(SILENCE_LIMIT_MS + 5_000);
    expect(seen).toContain("disconnected");
  });

  it("holds while frames keep arriving", () => {
    const wire = fakeWire();
    const seen: RealtimeStatus[] = [];
    new RealtimeChannel({
      url: "/api/r",
      createSource: wire.factory,
      onStatusChange: (status) => seen.push(status),
    });
    goLive(wire.latest());
    const beat = (index: number): void => {
      deliver(wire.latest(), {
        topic: CONTROL_TOPIC,
        type: "hb",
        data: { topics: ["tenant:t-1:kitchen"] },
        ts: index,
        id: `hb-${index}`,
      });
    };
    for (let index = 0; index < 6; index += 1) {
      vi.advanceTimersByTime(25_000);
      beat(index);
    }
    expect(seen).toEqual(["connecting", "connected"]);
  });
});

describe("RealtimeChannel — the client→server half", () => {
  it("reports canSend only on a wire that has one", () => {
    const wire = fakeWire();
    const socket = new RealtimeChannel({ url: "/api/r", createSource: wire.factory });
    expect(socket.canSend).toBe(true);

    const sse = new RealtimeChannel({
      url: "/api/r",
      createSource: (url) => wire.factory(url, "sse"),
    });
    // SSE is a one-way response body: a caller that needs to widen must branch on this
    // rather than discover at runtime that its subscribe went nowhere.
    expect(sse.canSend).toBe(false);
  });

  it("serialises a frame onto the wire", () => {
    const wire = fakeWire();
    const channel = new RealtimeChannel({ url: "/api/r", createSource: wire.factory });
    goLive(wire.latest());
    expect(channel.send({ type: "ping" })).toBe(true);
    expect(wire.latest().sent).toEqual(['{"type":"ping"}']);
  });

  it("answers false after close, and never queues for a later reconnect", () => {
    const wire = fakeWire();
    const channel = new RealtimeChannel({ url: "/api/r", createSource: wire.factory });
    goLive(wire.latest());
    channel.close();
    // Every verb is about THIS connection: one replayed onto a reconnected socket would
    // arrive describing a socket that no longer exists.
    expect(channel.send({ type: "ping" })).toBe(false);
  });
});

describe("RealtimeChannel — close", () => {
  it("closes the wire, cancels the pending reconnect and reports disconnected", () => {
    const wire = fakeWire();
    const seen: RealtimeStatus[] = [];
    const channel = new RealtimeChannel({
      url: "/api/r",
      createSource: wire.factory,
      onStatusChange: (status) => seen.push(status),
      random: () => 1,
    });
    goLive(wire.latest());
    drop(wire.latest());
    channel.close();
    vi.advanceTimersByTime(MAX_RETRY_MS * 2);
    expect(wire.built).toHaveLength(1);
    expect(seen.at(-1)).toBe("disconnected");
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("decodeMessage", () => {
  it("keeps a well-formed envelope and refuses everything else", () => {
    expect(__testables.decodeMessage('{"topic":"t","type":"x","data":{},"ts":1,"id":"i"}')).toEqual(
      { topic: "t", type: "x", data: {}, ts: 1, id: "i" },
    );
    expect(__testables.decodeMessage("not json")).toBeNull();
    expect(__testables.decodeMessage("null")).toBeNull();
    expect(__testables.decodeMessage('{"topic":"t"}')).toBeNull();
    expect(__testables.decodeMessage('{"type":"x"}')).toBeNull();
  });
});
