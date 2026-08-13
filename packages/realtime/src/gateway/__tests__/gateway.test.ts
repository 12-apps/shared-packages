/* eslint-disable test-flakiness/no-test-isolation -- every fixture here is built INSIDE its
   own `it` (`fakeSocket()`, `new TicketReplayGuard()`), so there is no state shared between cases. The rule's heuristic
   reads any `const` inside a `describe` as describe-level and then flags ordinary method
   calls on it; the same allowance `packages/prisma/package.test.ts` makes for the same
   misread. Isolation is enforced by construction — a fresh fixture per test — plus the
   `afterEach` resets below. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureRealtime, publishRealtimeEvent, resetRealtimeRuntime } from "../../core/runtime";
import {
  mintRealtimeTicket,
  TicketReplayGuard,
  verifyRealtimeTicket,
} from "../../core/ticket";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { attachConnection, Subscriptions, __testables, type GatewaySocket } from "../connection";
import { readGatewayConfig } from "../config";
import {
  INBOUND_BUCKET_CAPACITY,
  InboundRateLimiter,
  MAX_INBOUND_BYTES,
  readInboundFrame,
  __testables as inboundTestables,
} from "../inbound";

/**
 * The gateway's client→server protocol and its handshake, driven against a fake socket.
 *
 * The property every case here defends is the one the whole split exists for: this
 * process makes NO authorization decision, so a topic it was not handed in a signed
 * ticket is a topic it never subscribes to. A widening mid-connection has to be exactly as
 * strict as the handshake, and a captured ticket has to be worthless once used.
 */

const SECRET = "gateway-secret";
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** A socket that records everything, and lets a test fire its events. */
function fakeSocket() {
  const sent: string[] = [];
  const closes: { code?: number; reason?: string }[] = [];
  const listeners = new Map<string, ((raw?: unknown) => void)[]>();
  const state = { terminated: false, pings: 0 };

  const socket: GatewaySocket = {
    send: (payload) => sent.push(payload),
    close: (code, reason) => closes.push({ code, reason }),
    terminate: () => {
      state.terminated = true;
    },
    ping: () => {
      state.pings += 1;
    },
    on: (event: string, listener: (raw?: unknown) => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
      return socket;
    },
  } as GatewaySocket;

  return {
    socket,
    sent,
    closes,
    state,
    /** The client pushing a frame — the wire firing, not a user action. */
    pushFrame: (payload: unknown): void => {
      for (const listener of listeners.get("message") ?? []) listener(payload);
    },
    fireClose: (): void => {
      for (const listener of listeners.get("close") ?? []) listener();
    },
    /** Every control/event frame the gateway sent, decoded. */
    frames: (): { topic: string; type: string; data: unknown }[] =>
      sent.map((payload) => JSON.parse(payload) as { topic: string; type: string; data: unknown }),
  };
}

/**
 * Wait for the gateway's async message handler to settle.
 *
 * Microtask drains rather than a timer: the handler chain is
 * `message -> readInboundFrame -> applyFrame -> subscriptions.add -> subscribeRealtime`,
 * all promises with no scheduled work, so draining the queue is exact — and a timer would
 * be a guess that the flakiness gate is right to distrust.
 */
async function settle(): Promise<void> {
  for (let drain = 0; drain < 25; drain += 1) await Promise.resolve();
}

function attach(socket: ReturnType<typeof fakeSocket>, topics: readonly string[]) {
  const guard = new TicketReplayGuard();
  return {
    guard,
    attached: attachConnection({
      ws: socket.socket,
      topics,
      onClose: () => {},
      ticketSecret: SECRET,
      replayGuard: guard,
      logger: silentLogger,
    }),
  };
}

/** Mint and verify in one step — every helper below needs the verified form. */
function verifiedTicket(topics: readonly string[]) {
  const ticket = verifyRealtimeTicket(mintRealtimeTicket(topics, SECRET), SECRET);
  if (!ticket) throw new Error("expected a valid ticket");
  return ticket;
}

afterEach(() => {
  resetRealtimeRuntime();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("inbound frames — a closed verb set", () => {
  it("admits a ping", () => {
    expect(readInboundFrame('{"type":"ping"}', SECRET)).toEqual({
      ok: true,
      frame: { kind: "ping" },
    });
  });

  it("takes a subscribe's topics from the TICKET, never from the frame", () => {
    // The asymmetry is the whole security model: widening is an authorization decision,
    // and this process makes none.
    const ticket = mintRealtimeTicket(["tenant:t-1:kitchen"], SECRET);
    const result = readInboundFrame(
      JSON.stringify({ type: "subscribe", ticket, topics: ["tenant:OTHER:kitchen"] }),
      SECRET,
    );
    expect(result).toMatchObject({ ok: true, frame: { topics: ["tenant:t-1:kitchen"] } });
  });

  it("refuses a subscribe whose ticket is forged, expired or absent", () => {
    expect(readInboundFrame('{"type":"subscribe","ticket":"nope"}', SECRET)).toEqual({
      ok: false,
      reason: "bad-ticket",
    });
    expect(readInboundFrame('{"type":"subscribe"}', SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
    const foreign = mintRealtimeTicket(["tenant:t-1:kitchen"], "another-deployment");
    expect(readInboundFrame(JSON.stringify({ type: "subscribe", ticket: foreign }), SECRET)).toEqual(
      { ok: false, reason: "bad-ticket" },
    );
  });

  it("admits an unsubscribe with no ticket — narrowing discloses nothing", () => {
    expect(
      readInboundFrame('{"type":"unsubscribe","topics":["tenant:t-1:kitchen"]}', SECRET),
    ).toEqual({ ok: true, frame: { kind: "unsubscribe", topics: ["tenant:t-1:kitchen"] } });
  });

  it("bounds an unsigned unsubscribe list", () => {
    const topics = Array.from(
      { length: inboundTestables.MAX_UNSUBSCRIBE_TOPICS + 1 },
      (_, index) => `t-${index}`,
    );
    expect(readInboundFrame(JSON.stringify({ type: "unsubscribe", topics }), SECRET)).toEqual({
      ok: false,
      reason: "too-many-topics",
    });
  });

  it("refuses anything the protocol does not name", () => {
    expect(readInboundFrame('{"type":"mutate"}', SECRET)).toEqual({
      ok: false,
      reason: "unknown-verb",
    });
    expect(readInboundFrame('{"type":7}', SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(readInboundFrame("not json", SECRET)).toEqual({ ok: false, reason: "malformed" });
    expect(readInboundFrame("null", SECRET)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("inbound rate limiter", () => {
  it("spends the bucket and then refuses", () => {
    const limiter = new InboundRateLimiter(3, 1, 0);
    expect([limiter.take(0), limiter.take(0), limiter.take(0), limiter.take(0)]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("refills from elapsed time rather than from a timer", () => {
    const limiter = new InboundRateLimiter(2, 1, 0);
    limiter.take(0);
    limiter.take(0);
    expect(limiter.take(0)).toBe(false);
    expect(limiter.take(1_000)).toBe(true);
  });

  it("never refills past its capacity", () => {
    const limiter = new InboundRateLimiter(2, 1, 0);
    expect([limiter.take(1_000_000), limiter.take(1_000_000), limiter.take(1_000_000)]).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("Subscriptions", () => {
  it("is idempotent by name and reserves the name before awaiting", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const subscriptions = new Subscriptions(() => {});
    // Two frames racing on the same topic must not leave one handle orphaned — an orphan
    // keeps delivering after an unsubscribe, which reads as a gateway ignoring its client.
    await Promise.all([
      subscriptions.add("tenant:t-1:kitchen"),
      subscriptions.add("tenant:t-1:kitchen"),
    ]);
    expect(subscriptions.topics).toEqual(["tenant:t-1:kitchen"]);
  });

  it("removing a name it does not hold is not an error", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const subscriptions = new Subscriptions(() => {});
    await expect(subscriptions.remove("tenant:t-1:nothing")).resolves.toBeUndefined();
  });
});

describe("the attached connection", () => {
  it("relays a published event in the frame the SSE wire uses", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;

    await publishRealtimeEvent("tenant:t-1:kitchen", {
      type: "kitchen.changed",
      data: { ticketId: "k-1" },
    });
    expect(socket.frames()).toEqual([
      {
        topic: "tenant:t-1:kitchen",
        type: "kitchen.changed",
        data: { ticketId: "k-1" },
        ts: expect.any(Number) as unknown as number,
        id: expect.any(String) as unknown as string,
      },
    ]);
  });

  it("never relays a topic the ticket did not name", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    await publishRealtimeEvent("tenant:t-2:kitchen", { type: "kitchen.changed", data: {} });
    expect(socket.sent).toEqual([]);
  });

  it("answers a ping with the topic list it believes it serves", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    socket.pushFrame('{"type":"ping"}');
    await settle();
    expect(socket.frames()).toEqual([
      {
        topic: __testables.GATEWAY_TOPIC,
        type: "pong",
        data: { topics: ["tenant:t-1:kitchen"] },
        ts: expect.any(Number) as unknown as number,
        id: expect.any(String) as unknown as string,
      },
    ]);
  });

  it("widens on a signed subscribe, and answers with the new list", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    const ticket = mintRealtimeTicket(["tenant:t-1:orders"], SECRET);
    socket.pushFrame(JSON.stringify({ type: "subscribe", ticket }));
    await settle();
    expect(socket.frames().at(-1)).toMatchObject({
      type: "subscribed",
      data: { topics: ["tenant:t-1:kitchen", "tenant:t-1:orders"] },
    });
  });

  it("BURNS the widening ticket, so one captured ticket cannot widen twice", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    const ticket = mintRealtimeTicket(["tenant:t-1:orders"], SECRET);
    const push = (): void => {
      socket.pushFrame(JSON.stringify({ type: "subscribe", ticket }));
    };
    push();
    await settle();
    push();
    await settle();
    expect(socket.frames().at(-1)).toMatchObject({
      type: "error",
      data: { reason: "replayed-ticket" },
    });
  });

  it("narrows on an unsubscribe and answers with the remainder", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen", "tenant:t-1:orders"]).attached;
    socket.pushFrame('{"type":"unsubscribe","topics":["tenant:t-1:orders"]}');
    await settle();
    expect(socket.frames().at(-1)).toMatchObject({
      type: "unsubscribed",
      data: { topics: ["tenant:t-1:kitchen"] },
    });
  });

  it("closes the socket with 1008 when a client is rate limited", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    const flood = (): void => {
      for (let index = 0; index < INBOUND_BUCKET_CAPACITY + 2; index += 1) {
        socket.pushFrame('{"type":"ping"}');
      }
    };
    flood();
    await settle();
    // 1008 "policy violation" — a code the client's reconnect treats like any other
    // close, so a rate-limited client backs off rather than hammering. The flood keeps
    // pushing after the close, so assert the FIRST refusal rather than the count.
    expect(socket.closes[0]).toEqual({ code: 1008, reason: "rate-limited" });
  });

  it("refuses an oversized raw message before parsing it", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    socket.pushFrame("x".repeat(MAX_INBOUND_BYTES + 1));
    await settle();
    expect(socket.frames().at(-1)).toMatchObject({ type: "error", data: { reason: "malformed" } });
  });

  it("closes the socket with 1011 when the bus refuses the handshake subscribe", async () => {
    // No driver: subscribing throws. The client sees a drop and reconnects, which is the
    // old path working exactly as intended.
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    expect(socket.closes).toEqual([{ code: 1011, reason: "subscribe failed" }]);
  });

  it("terminates a socket that stopped answering the liveness probe", async () => {
    vi.useFakeTimers();
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    // A tablet on dying wifi leaves a socket that looks open forever, holding a bus
    // subscription and a connection slot.
    vi.advanceTimersByTime(__testables.HEARTBEAT_MS);
    expect(socket.state.pings).toBe(1);
    vi.advanceTimersByTime(__testables.HEARTBEAT_MS);
    expect(socket.state.terminated).toBe(true);
  });

  it("sends a DATA heartbeat beside the protocol ping", async () => {
    vi.useFakeTimers();
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    // `ws.ping()` proves liveness TO THE SERVER: the browser answers the pong itself and
    // the page's JavaScript is never told.
    vi.advanceTimersByTime(__testables.HEARTBEAT_MS);
    expect(socket.frames().at(-1)).toMatchObject({
      topic: __testables.GATEWAY_TOPIC,
      type: "hb",
      data: { topics: ["tenant:t-1:kitchen"] },
    });
  });

  it("stops the heartbeat when the socket closes", async () => {
    vi.useFakeTimers();
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const socket = fakeSocket();
    await attach(socket, ["tenant:t-1:kitchen"]).attached;
    socket.fireClose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the handshake's replay guard", () => {
  it("admits a ticket once", () => {
    const guard = new TicketReplayGuard();
    const ticket = verifiedTicket(["tenant:t-1:kitchen"]);
    expect(guard.consume(ticket)).toBe(true);
    expect(guard.consume(ticket)).toBe(false);
  });
});

describe("gateway config", () => {
  it("throws rather than starting a gateway that can verify nothing", () => {
    vi.stubEnv("REALTIME_TICKET_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => readGatewayConfig()).toThrow(/cannot verify tickets/);
  });

  it("resolves the ticket secret in the SAME order as the API side", () => {
    vi.stubEnv("REALTIME_TICKET_SECRET", "dedicated");
    vi.stubEnv("AUTH_SECRET", "session");
    expect(readGatewayConfig().ticketSecret).toBe("dedicated");
    vi.stubEnv("REALTIME_TICKET_SECRET", "");
    expect(readGatewayConfig().ticketSecret).toBe("session");
    expect(readGatewayConfig({ ticketSecret: "explicit" }).ticketSecret).toBe("explicit");
  });

  it("reads the port and cap from the environment at CALL time", () => {
    vi.stubEnv("AUTH_SECRET", "session");
    vi.stubEnv("REALTIME_GATEWAY_PORT", "4100");
    vi.stubEnv("REALTIME_GATEWAY_MAX_CONNECTIONS", "7");
    expect(readGatewayConfig()).toMatchObject({ port: 4100, maxConnections: 7 });
  });

  it("refuses a non-positive integer rather than falling back silently", () => {
    vi.stubEnv("AUTH_SECRET", "session");
    vi.stubEnv("REALTIME_GATEWAY_PORT", "0");
    expect(() => readGatewayConfig()).toThrow(/positive integer/);
  });

  it("defaults the socket and health paths", () => {
    vi.stubEnv("AUTH_SECRET", "session");
    vi.stubEnv("REALTIME_GATEWAY_PORT", "");
    expect(readGatewayConfig()).toMatchObject({ socketPath: "/ws", healthPath: "/health" });
  });
});
