import { describe, expect, it } from "vitest";

import { mintRealtimeTicket, TicketReplayGuard } from "../../core/ticket";
import { CapLedger, capFor, parseTopicCaps, topicMatches } from "../caps";
import { readGatewayConfig } from "../config";
import { __testables, type GatewaySocket } from "../index";

/**
 * Per-class socket caps: a flood of one kind of subscriber (an anonymous TV surface)
 * can never take the slots another kind (staff screens) needs.
 */

const SECRET = "caps-secret";
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

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
    expect(() => parseTopicCaps("tenant:*:catalog")).toThrow(
      /pattern=positive-integer/,
    );
    expect(() => parseTopicCaps("tenant:*:catalog=0")).toThrow();
    expect(() => parseTopicCaps("tenant:*:catalog=lots")).toThrow();
  });

  it("is read from the environment by the config", () => {
    process.env.REALTIME_GATEWAY_TOPIC_CAPS = "tenant:*:catalog=7";
    try {
      expect(readGatewayConfig({ ticketSecret: SECRET }).topicCaps).toEqual([
        { pattern: "tenant:*:catalog", maxConnections: 7 },
      ]);
    } finally {
      delete process.env.REALTIME_GATEWAY_TOPIC_CAPS;
    }
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
function rawSocket() {
  const written: string[] = [];
  return {
    written,
    destroyed: { value: false },
    write: (chunk: string) => written.push(chunk),
    destroy() {
      this.destroyed.value = true;
    },
  };
}

/** A `ws` server stand-in that completes every handshake with a fresh fake socket. */
function fakeWss(closes: { code?: number }[]) {
  return {
    handleUpgrade: (
      _req: unknown,
      _socket: unknown,
      _head: Buffer,
      callback: (ws: GatewaySocket) => void,
    ) => {
      const ws = {
        send: () => {},
        close: (code?: number) => closes.push({ code }),
        terminate: () => {},
        ping: () => {},
        on: () => ws,
      } as unknown as GatewaySocket;
      callback(ws);
    },
    close: () => {},
  };
}

describe("the upgrade respects the class bound", () => {
  it("refuses the class's (max+1)th socket with 503 while a staff ticket still connects", () => {
    const config = readGatewayConfig({
      ticketSecret: SECRET,
      redisUrl: null,
      maxConnections: 10,
      topicCaps: [{ pattern: "tenant:*:catalog", maxConnections: 2 }],
    });
    const sockets = new Set<GatewaySocket>();
    const closes: { code?: number }[] = [];
    const deps = {
      config,
      sockets,
      replayGuard: new TicketReplayGuard(),
      wss: fakeWss(closes),
      logger: silentLogger,
      caps: new CapLedger<GatewaySocket>(),
    };
    const upgrade = (topics: string[]) => {
      const raw = rawSocket();
      const ticket = mintRealtimeTicket(topics, SECRET);
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

    upgrade(["tenant:c1:catalog"]);
    upgrade(["tenant:c2:catalog"]);
    const third = upgrade(["tenant:c3:catalog"]);
    expect(third.written.join("")).toContain("503");
    expect(sockets.size).toBe(2);

    const staff = upgrade(["tenant:c1:orders"]);
    expect(staff.written).toEqual([]);
    expect(sockets.size).toBe(3);
    expect(closes).toEqual([]);
  });

  it("an unverified upgrade never counts against the class", () => {
    const config = readGatewayConfig({
      ticketSecret: SECRET,
      redisUrl: null,
      topicCaps: [{ pattern: "tenant:*:catalog", maxConnections: 1 }],
    });
    const caps = new CapLedger<GatewaySocket>();
    const deps = {
      config,
      sockets: new Set<GatewaySocket>(),
      replayGuard: new TicketReplayGuard(),
      wss: fakeWss([]),
      logger: silentLogger,
      caps,
    };
    const raw = rawSocket();
    __testables.handleUpgrade(
      deps,
      { url: "/ws?ticket=forged", headers: { host: "gw" } } as never,
      raw,
      Buffer.alloc(0),
    );
    expect(raw.written.join("")).toContain("401");
    expect(caps.count(config.topicCaps[0]!)).toBe(0);
  });
});
