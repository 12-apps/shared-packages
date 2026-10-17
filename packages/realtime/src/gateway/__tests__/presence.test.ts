import { afterEach, describe, expect, it } from "vitest";

import { PRESENCE_TOPIC, PresenceTracker, presenceChangesOf } from "../../core/presence";
import { configureRealtime, resetRealtimeRuntime } from "../../core/runtime";
import { mintRealtimeTicket, TicketReplayGuard } from "../../core/ticket";
import { createInlineRealtimeDriver } from "../../drivers/inline";
import { CapLedger } from "../caps";
import { readGatewayConfig } from "../config";
import { __testables, type GatewaySocket } from "../index";

/**
 * The gateway holds a socket's presence keys for exactly the socket's life.
 *
 * It decides nothing about whose they are — the keys arrive signed in the handshake
 * ticket, the same way topics do — and it must release them on EVERY way a socket
 * ends: a clean close, an error, the liveness sweep's terminate. A key left held by a
 * socket that is gone is a person drawn as present after they left.
 */

const SECRET = "gateway-presence-secret";
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** A raw socket before the handshake. */
function rawSocket() {
  return { write: () => undefined, destroy: () => undefined };
}

/** One admitted socket, and the way the wire ends it. */
interface FakeConnection {
  drop: () => void;
}

/** A `ws` server stand-in that completes each handshake with a fake socket. */
function fakeWss(connections: FakeConnection[]) {
  return {
    handleUpgrade: (
      _request: unknown,
      _socket: unknown,
      _head: Buffer,
      callback: (ws: GatewaySocket) => void,
    ) => {
      const listeners = new Map<string, (() => void)[]>();
      const ws = {
        send: () => undefined,
        close: () => undefined,
        terminate: () => undefined,
        ping: () => undefined,
        on: (event: string, listener: () => void) => {
          listeners.set(event, [...(listeners.get(event) ?? []), listener]);
          return ws;
        },
      } as unknown as GatewaySocket;
      connections.push({ drop: () => (listeners.get("close") ?? []).forEach((listener) => listener()) });
      callback(ws);
    },
    close: () => undefined,
  };
}

/** A gateway's upgrade path over a real inline bus. */
function gateway() {
  const driver = createInlineRealtimeDriver({ logger: silentLogger });
  configureRealtime({ driver, logger: silentLogger });
  const connections: FakeConnection[] = [];
  const presence = new PresenceTracker({ logger: silentLogger });
  const deps = {
    config: readGatewayConfig({ ticketSecret: SECRET, redisUrl: null }),
    sockets: new Set<GatewaySocket>(),
    replayGuard: new TicketReplayGuard(),
    wss: fakeWss(connections),
    logger: silentLogger,
    caps: new CapLedger<GatewaySocket>(),
    presence,
  };
  const upgrade = (ticket: string): void => {
    __testables.handleUpgrade(
      deps,
      { url: `/ws?ticket=${encodeURIComponent(ticket)}`, headers: { host: "gw" } } as never,
      rawSocket(),
      Buffer.alloc(0),
    );
  };
  return {
    connections,
    presence,
    upgrade,
    changes: () =>
      driver.published
        .filter((record) => record.topic === PRESENCE_TOPIC)
        .flatMap((record) => presenceChangesOf(record.event)),
  };
}

/** Let the bus's fire-and-forget publishes and the attach chain settle. */
async function settle(): Promise<void> {
  for (let drain = 0; drain < 25; drain += 1) await Promise.resolve();
}

function seatTicket(): string {
  return mintRealtimeTicket(["tenant:t-1:comanda:s-1"], SECRET, undefined, {
    presence: ["seat:t-1:s-1:p-1"],
  });
}

afterEach(() => {
  resetRealtimeRuntime();
});

describe("gateway presence", () => {
  it("holds the ticket's keys from admission and releases them when the socket closes", async () => {
    const gw = gateway();
    gw.upgrade(seatTicket());
    await settle();
    expect(gw.changes()).toEqual([{ key: "seat:t-1:s-1:p-1", state: "held" }]);

    gw.connections[0]?.drop();
    await settle();
    expect(gw.changes()).toEqual([
      { key: "seat:t-1:s-1:p-1", state: "held" },
      { key: "seat:t-1:s-1:p-1", state: "released" },
    ]);
  });

  it("keeps a key held while a second socket for it is still open — two tabs, one person", async () => {
    const gw = gateway();
    gw.upgrade(seatTicket());
    gw.upgrade(seatTicket());
    await settle();
    gw.connections[0]?.drop();
    await settle();
    expect(gw.changes().map((change) => change.state)).toEqual(["held"]);

    gw.connections[1]?.drop();
    await settle();
    expect(gw.changes().map((change) => change.state)).toEqual(["held", "released"]);
  });

  it("holds nothing for a ticket that names no key", async () => {
    const gw = gateway();
    gw.upgrade(mintRealtimeTicket(["tenant:t-1:kitchen"], SECRET));
    await settle();
    gw.connections[0]?.drop();
    await settle();
    expect(gw.changes()).toEqual([]);
    expect(gw.presence.size).toBe(0);
  });

  it("holds nothing for a refused upgrade", async () => {
    const gw = gateway();
    gw.upgrade("forged.ticket");
    await settle();
    expect(gw.connections).toHaveLength(0);
    expect(gw.changes()).toEqual([]);
  });
});
