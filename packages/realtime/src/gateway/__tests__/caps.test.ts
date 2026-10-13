import { afterEach, describe, expect, it, vi } from "vitest";

import { configureRealtime, resetRealtimeRuntime } from "../../core/runtime";
import { mintRealtimeTicket, TicketReplayGuard } from "../../core/ticket";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { CapLedger, capFor, parseTopicCaps, topicMatches, warnOnUnsafeCaps } from "../caps";
import { readGatewayConfig } from "../config";
import { __testables, type GatewaySocket } from "../index";

/**
 * Per-class socket caps: a flood of one kind of subscriber (an anonymous TV surface)
 * can never take the slots another kind (staff screens) needs.
 */

const SECRET = "caps-secret";
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

afterEach(() => {
  vi.unstubAllEnvs();
  resetRealtimeRuntime();
});

describe("topicMatches", () => {
  it("matches one segment per *", () => {
    expect(topicMatches("tenant:*:catalog", "tenant:c1:catalog")).toBe(true);
    expect(topicMatches("tenant:*:catalog", "tenant:c1:orders")).toBe(false);
    expect(topicMatches("tenant:*:catalog", "tenant:c1:catalog:x")).toBe(false);
    expect(topicMatches("tenant:*:catalog", "tenant:a:b:catalog")).toBe(false);
  });
});

describe("capFor", () => {
  const tv = { pattern: "tenant:*:catalog", maxConnections: 2 };

  it("classifies a ticket whose topics all match", () => {
    expect(capFor([tv], ["tenant:c1:catalog"])).toBe(tv);
  });

  it("never squeezes a ticket carrying anything else", () => {
    expect(capFor([tv], ["tenant:c1:catalog", "tenant:c1:orders"])).toBeNull();
  });

  it("an empty topic list belongs to no class", () => {
    expect(capFor([tv], [])).toBeNull();
  });
});

describe("parseTopicCaps", () => {
  it("reads pattern=max pairs", () => {
    expect(parseTopicCaps(" tenant:*:catalog=500 , user:*:x=3")).toEqual([
      { pattern: "tenant:*:catalog", maxConnections: 500 },
      { pattern: "user:*:x", maxConnections: 3 },
    ]);
  });

  it("unset is no cap", () => {
    expect(parseTopicCaps(undefined)).toEqual([]);
    expect(parseTopicCaps("  ")).toEqual([]);
  });

  it("refuses to start on anything it cannot read", () => {
    expect(() => parseTopicCaps("tenant:*:catalog")).toThrow(/pattern=positive-integer/);
    expect(() => parseTopicCaps("tenant:*:catalog=0")).toThrow();
    expect(() => parseTopicCaps("tenant:*:catalog=lots")).toThrow();
  });

  it("refuses a pattern that is not one, or one listed twice", () => {
    expect(() => parseTopicCaps("tenant::catalog=5")).toThrow(/not a topic pattern/);
    expect(() => parseTopicCaps("*:*:*=5")).toThrow(/not a topic pattern/);
    expect(() => parseTopicCaps("a:*=1,a:*=2")).toThrow(/listed twice/);
  });

  it("is read from the environment by the config", () => {
    vi.stubEnv("REALTIME_GATEWAY_TOPIC_CAPS", "tenant:*:catalog=7");
    expect(readGatewayConfig({ ticketSecret: SECRET }).topicCaps).toEqual([
      { pattern: "tenant:*:catalog", maxConnections: 7 },
    ]);
  });
});

describe("CapLedger", () => {
  it("admits up to the bound and frees on release", () => {
    const cap = { pattern: "a:*", maxConnections: 1 };
    const ledger = new CapLedger<string>();
    expect(ledger.admit(cap, "s1")).toBe(true);
    expect(ledger.hasRoom(cap)).toBe(false);
    expect(ledger.admit(cap, "s2")).toBe(false);
    ledger.release("s1");
    ledger.release("s1");
    expect(ledger.count(cap)).toBe(0);
    expect(ledger.admit(cap, "s2")).toBe(true);
  });
});

/** A raw socket before the handshake, recording what was written to it. */
function rawSocket(): {
  written: string[];
  write: (chunk: string) => void;
  destroy: () => void;
} {
  const written: string[] = [];
  return {
    written,
    write: (chunk) => written.push(chunk),
    destroy: () => undefined,
  };
}

/** A completed handshake: the socket, its close codes, and a way to drop it. */
interface FakeConnection {
  ws: GatewaySocket;
  closes: (number | undefined)[];
  drop: () => void;
}

/** A `ws` server stand-in that completes each handshake with a fresh fake socket. */
function fakeWss(connections: FakeConnection[], defer = false) {
  return {
    handleUpgrade: (
      _request: unknown,
      _socket: unknown,
      _head: Buffer,
      callback: (ws: GatewaySocket) => void,
    ) => {
      const listeners = new Map<string, (() => void)[]>();
      const closes: (number | undefined)[] = [];
      const ws = {
        send: () => undefined,
        close: (code?: number) => closes.push(code),
        terminate: () => undefined,
        ping: () => undefined,
        on: (event: string, listener: () => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
          return ws;
        },
      } as unknown as GatewaySocket;
      connections.push({
        ws,
        closes,
        drop: () => (listeners.get("close") ?? []).forEach((listener) => listener()),
      });
      if (defer) queueMicrotask(() => callback(ws));
      else callback(ws);
    },
    close: () => undefined,
  };
}

/** A gateway's upgrade path over a real inline bus, with `max` slots in the TV class. */
function gateway(max: number, options: { defer?: boolean; caps?: CapLedger<GatewaySocket> } = {}) {
  configureRealtime({
    driver: createInlineRealtimeDriver({ logger: silentLogger }),
    logger: silentLogger,
  });
  const config = readGatewayConfig({
    ticketSecret: SECRET,
    redisUrl: null,
    maxConnections: 10,
    topicCaps: [{ pattern: "tenant:*:catalog", maxConnections: max }],
  });
  const connections: FakeConnection[] = [];
  const deps = {
    config,
    sockets: new Set<GatewaySocket>(),
    replayGuard: new TicketReplayGuard(),
    wss: fakeWss(connections, options.defer),
    logger: silentLogger,
    caps: options.caps ?? new CapLedger<GatewaySocket>(),
  };
  const upgrade = (topics: string[], ticket = mintRealtimeTicket(topics, SECRET)) => {
    const raw = rawSocket();
    __testables.handleUpgrade(
      deps,
      {
        url: `/ws?ticket=${encodeURIComponent(ticket)}`,
        headers: { host: "gw" },
      } as never,
      raw,
      Buffer.alloc(0),
    );
    return raw;
  };
  /** The client dropping its `index`th connection — the wire closing, not a test call. */
  const drop = (index: number): void => connections[index]?.drop();
  /** Every close code each handshake's socket received, in order. */
  const closeCodes = (): (number | undefined)[][] => connections.map((c) => [...c.closes]);
  return { deps, upgrade, drop, closeCodes, cap: config.topicCaps?.[0] };
}

/** Let the connection's async subscribe settle before asserting the steady state. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the upgrade respects the class bound", () => {
  it("refuses the class's (max+1)th socket with 503 while a staff ticket still connects", async () => {
    const { deps, closeCodes, upgrade, cap } = gateway(2);
    upgrade(["tenant:c1:catalog"]);
    upgrade(["tenant:c2:catalog"]);
    const third = upgrade(["tenant:c3:catalog"]);
    const staff = upgrade(["tenant:c1:orders"]);
    await settle();

    expect(third.written.join("")).toContain("503");
    expect(staff.written).toEqual([]);
    expect(deps.sockets.size).toBe(3);
    expect(deps.caps.count(cap!)).toBe(2);
    expect(closeCodes().flat()).toEqual([]);
  });

  it("a closed class socket frees its slot for the next one", async () => {
    const { deps, upgrade, drop, cap } = gateway(1);
    upgrade(["tenant:c1:catalog"]);
    await settle();
    expect(upgrade(["tenant:c2:catalog"]).written.join("")).toContain("503");

    drop(0);
    expect(deps.caps.count(cap!)).toBe(0);
    expect(upgrade(["tenant:c2:catalog"]).written).toEqual([]);
    await settle();
    expect(deps.caps.count(cap!)).toBe(1);
  });

  it("a refusal for capacity leaves the ticket usable, like the global 503", async () => {
    const { upgrade, drop } = gateway(1);
    upgrade(["tenant:c1:catalog"]);
    await settle();
    const ticket = mintRealtimeTicket(["tenant:c2:catalog"], SECRET);
    expect(upgrade(["tenant:c2:catalog"], ticket).written.join("")).toContain("503");
    drop(0);
    expect(upgrade(["tenant:c2:catalog"], ticket).written).toEqual([]);
  });

  it("closes the loser with 1013 when two deferred handshakes race for the last slot", async () => {
    const { deps, closeCodes, upgrade, cap } = gateway(1, { defer: true });
    upgrade(["tenant:c1:catalog"]);
    upgrade(["tenant:c2:catalog"]);
    await settle();
    expect(closeCodes()).toEqual([[], [1013]]);
    expect(deps.caps.count(cap!)).toBe(1);
    expect(deps.sockets.size).toBe(1);
  });

  it("an unverified upgrade never counts against the class", () => {
    const { deps, upgrade, cap } = gateway(1);
    expect(upgrade([], "forged").written.join("")).toContain("401");
    expect(deps.caps.count(cap!)).toBe(0);
  });

  it("with no caps configured nothing is classed", async () => {
    configureRealtime({
      driver: createInlineRealtimeDriver({ logger: silentLogger }),
      logger: silentLogger,
    });
    const config = readGatewayConfig({ ticketSecret: SECRET, redisUrl: null });
    expect(config.topicCaps).toEqual([]);
    const sockets = new Set<GatewaySocket>();
    const connections: FakeConnection[] = [];
    const raw = rawSocket();
    __testables.handleUpgrade(
      {
        config,
        sockets,
        replayGuard: new TicketReplayGuard(),
        wss: fakeWss(connections),
        logger: silentLogger,
        caps: new CapLedger<GatewaySocket>(),
      },
      {
        url: `/ws?ticket=${encodeURIComponent(mintRealtimeTicket(["tenant:c1:catalog"], SECRET))}`,
        headers: { host: "gw" },
      } as never,
      raw,
      Buffer.alloc(0),
    );
    await settle();
    expect(raw.written).toEqual([]);
    expect(sockets.size).toBe(1);
  });
});

describe("warnOnUnsafeCaps", () => {
  it("warns when the caps leave staff no headroom, and is quiet otherwise", () => {
    const warn = vi.fn();
    const logger = { ...silentLogger, warn };
    const base = readGatewayConfig({
      ticketSecret: SECRET,
      redisUrl: null,
      maxConnections: 10,
    });
    warnOnUnsafeCaps({ ...base, topicCaps: [{ pattern: "a:*", maxConnections: 4 }] }, logger);
    expect(warn).not.toHaveBeenCalled();
    warnOnUnsafeCaps({ ...base, topicCaps: [{ pattern: "a:*", maxConnections: 10 }] }, logger);
    expect(warn).toHaveBeenCalledOnce();
  });
});
