import { afterEach, describe, expect, it } from "vitest";

import type { CaptureTrace } from "../../terminal-link";
import { isPrivateIpv4, privateBindAddresses, type InterfaceAddress } from "../terminal-bind";
import { createTerminalLinkServer } from "../terminal-link";
import { CLOSE } from "../terminal-link-api";
import { connectTerminal, fakeSealer, link, memoryCache, resign, startStation, type FakeTerminal, type Station } from "./harness";
import { wsListen } from "./ws-listeners";

/**
 * The station's LAN server, against a REAL `ws` client on 127.0.0.1 that
 * speaks as the terminal through `../../terminal-link`. Ported from the
 * origin host's suite.
 */

const open: { stations: Station[]; terminals: FakeTerminal[] } = { stations: [], terminals: [] };

afterEach(async () => {
  for (const terminal of open.terminals.splice(0)) terminal.socket.terminate();
  await Promise.all(open.stations.splice(0).map((station) => station.server.stop()));
});

async function station(...args: Parameters<typeof startStation>): Promise<Station> {
  const started = await startStation(...args);
  open.stations.push(started);
  return started;
}

async function terminal(...args: Parameters<typeof connectTerminal>): Promise<FakeTerminal> {
  const connected = await connectTerminal(...args);
  open.terminals.push(connected);
  return connected;
}

const POS = link("pos-1");

const CAPTURE: CaptureTrace = {
  transactionCode: "TX-0001",
  transactionId: "NSU-77",
  authorizationCode: "A1B2C3",
  brand: "VISA",
  installments: 1,
  serial: "PBX-123",
  entryMode: "CHIP",
  amountCents: 6490,
  kind: "DEBIT",
  capturedAt: "2026-11-03T15:00:00.000Z",
};

const LEG = { saleRef: "5532", operator: "Cláudia Rangel", amountCents: 6490, method: "DEBIT" } as const;

describe("who may connect", () => {
  it("a valid hello connects, and the terminal reads as connected", async () => {
    const s = await station([POS]);
    expect(s.server.state().terminals).toEqual([{ deviceId: "pos-1", provider: "PAGBANK", lanAddress: null, status: "disconnected", pending: null }]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    expect(t.peer.sid).not.toBeNull();
    await s.event((event) => event.kind === "state" && event.state.terminals[0]?.status === "connected");
    expect(s.server.state().terminals[0]?.status).toBe("connected");
  });

  it("a hello signed with another secret is refused and closed", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", link("pos-1").secret, { hello: false });
    t.send(t.peer.hello());
    expect(await t.closed).toMatchObject({ code: CLOSE.refused, reason: "bad-mac" });
    expect(s.server.state().terminals[0]?.status).toBe("disconnected");
  });

  it("an unknown device is refused and closed", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-9", POS.secret, { hello: false });
    t.send(t.peer.hello());
    expect(await t.closed).toMatchObject({ code: CLOSE.unknownDevice });
  });

  it("a replayed hello — the same frame on a new connection — is refused and closed", async () => {
    const s = await station([POS]);
    const first = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    const hello = first.peer.hello();
    first.send(hello);
    await first.next();
    const replay = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    replay.send(hello);
    expect(await replay.closed).toMatchObject({ code: CLOSE.refused, reason: "replayed" });
  });

  it("a replayed counter inside the session is refused and closed", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const pong = t.peer.seal({ type: "pong" });
    t.send(pong);
    t.send(pong);
    expect(await t.closed).toMatchObject({ code: CLOSE.refused, reason: "replayed" });
    expect(s.server.state().terminals[0]?.status).toBe("disconnected");
  });

  it("an unknown key is refused and closed, in the hello and inside the session", async () => {
    const s = await station([POS]);
    const early = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    early.send(resign(early.peer.hello(), POS.secret, (record) => (record.ip = "10.0.0.9")));
    expect(await early.closed).toMatchObject({ code: CLOSE.malformed, reason: "unknown-key" });

    const late = await terminal(s.url, "pos-1", POS.secret);
    late.send(resign(late.peer.seal({ type: "pong" }), POS.secret, (record) => (record.extra = true)));
    expect(await late.closed).toMatchObject({ code: CLOSE.refused, reason: "unknown-key" });
  });

  it("a first frame that is not a hello is closed", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    t.send("not json");
    expect(await t.closed).toMatchObject({ code: CLOSE.malformed });
  });

  it("a connection that never says hello is closed", async () => {
    const s = await station([POS], { helloTimeoutMs: 50 });
    const t = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    expect(await t.closed).toMatchObject({ code: CLOSE.helloTimeout });
  });
});

describe("a charge", () => {
  it("is delivered to the terminal, signed, with the split's parts", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const answer = s.server.charge({ ...LEG, part: 1, parts: 2, remainingCents: 6360 });
    expect(answer).toMatchObject({ ok: true, deviceId: "pos-1" });
    const message = await t.next();
    expect(message).toMatchObject({ type: "charge", ...LEG, part: 1, parts: 2, remainingCents: 6360 });
    expect(message.type === "charge" && answer.ok && message.chargeId === answer.chargeId).toBe(true);
  });

  it("approved, declined and cancelled come back to the page; a decline keeps the charge open, approval and cancel close it", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);

    const first = s.server.charge(LEG);
    if (!first.ok) throw new Error("not charged");
    await t.next();
    t.send(t.peer.seal({ type: "status", chargeId: first.chargeId, state: "declined" }));
    await s.event((event) => event.kind === "status" && event.state === "declined");
    // "Tentar de novo" is the terminal's: the charge is still open there.
    expect(s.server.charge(LEG)).toEqual({ ok: false, code: "BUSY" });
    t.send(t.peer.seal({ type: "status", chargeId: first.chargeId, state: "approved", capture: CAPTURE }));
    expect(await s.event((event) => event.kind === "status" && event.state === "approved")).toEqual({
      kind: "status",
      deviceId: "pos-1",
      chargeId: first.chargeId,
      state: "approved",
      capture: CAPTURE,
    });

    const second = s.server.charge(LEG);
    if (!second.ok) throw new Error("not charged after the approval");
    await t.next();
    t.send(t.peer.seal({ type: "status", chargeId: second.chargeId, state: "cancelled" }));
    await s.event((event) => event.kind === "status" && event.state === "cancelled");
    expect(s.server.charge(LEG).ok).toBe(true);
  });

  it("a status for a charge the station never sent to that terminal is ignored", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const answer = s.server.charge(LEG);
    if (!answer.ok) throw new Error("not charged");
    await t.next();
    t.send(t.peer.seal({ type: "status", chargeId: "invented", state: "approved", capture: CAPTURE }));
    t.send(t.peer.seal({ type: "status", chargeId: answer.chargeId, state: "processing" }));
    // Frames are handled in order: once the real one is in, the invented one was seen and dropped.
    await s.event((event) => event.kind === "status" && event.chargeId === answer.chargeId);
    expect(s.events.filter((event) => event.kind === "status").map((event) => event.kind === "status" && event.chargeId)).toEqual([answer.chargeId]);
    expect(t.socket.readyState).toBe(t.socket.OPEN);
  });

  it("a cancel from the computer reaches the terminal", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const answer = s.server.charge(LEG);
    if (!answer.ok) throw new Error("not charged");
    await t.next();
    expect(s.server.cancel(answer.chargeId)).toBe("SENT");
    expect(await t.next()).toMatchObject({ type: "cancel", chargeId: answer.chargeId });
    expect(s.server.cancel("unknown")).toBe("NO_CHARGE");
  });

  it("typed captures the terminal took with no link reach the page", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    t.send(t.peer.seal({ type: "typed_captures", captures: [CAPTURE] }));
    expect(await s.event((event) => event.kind === "typed-captures")).toEqual({ kind: "typed-captures", deviceId: "pos-1", captures: [CAPTURE] });
  });

  it("is refused with nothing linked, to a device not linked, and with the terminal away; a second link of one provider is dropped", async () => {
    expect((await station([])).server.charge(LEG)).toEqual({ ok: false, code: "NO_TERMINAL" });
    const two = await station([POS, { ...link("pos-2"), provider: "PAGBANK" }]);
    // One link per provider: the second PAGBANK link is dropped as it is read.
    expect(two.server.state().terminals.map((entry) => entry.deviceId)).toEqual(["pos-1"]);
    const s = await station([POS]);
    expect(s.server.charge(LEG)).toEqual({ ok: false, code: "NOT_CONNECTED" });
    expect(s.server.charge({ ...LEG, deviceId: "pos-9" })).toEqual({ ok: false, code: "NO_TERMINAL" });
  });
});

describe("the live connection", () => {
  it("heartbeat loss marks the terminal disconnected", async () => {
    const s = await station([POS], { pingIntervalMs: 20, maxMissedPongs: 2 });
    const t = await terminal(s.url, "pos-1", POS.secret);
    // The terminal answers nothing: two pings unanswered, and the third tick drops it.
    expect((await t.next()).type).toBe("ping");
    const connectedAt = s.events.length;
    expect((await t.closed).code).toBe(1006);
    expect(s.server.state().terminals[0]?.status).toBe("disconnected");
    // The page heard it: a state pushed after the connection, saying disconnected.
    expect(s.events.slice(connectedAt).some((event) => event.kind === "state" && event.state.terminals[0]?.status === "disconnected")).toBe(true);
  });

  it("a terminal that answers the pings stays connected", async () => {
    const s = await station([POS], { pingIntervalMs: 20, maxMissedPongs: 2 });
    const t = await terminal(s.url, "pos-1", POS.secret);
    for (let i = 0; i < 6; i++) {
      expect((await t.next()).type).toBe("ping");
      t.send(t.peer.seal({ type: "pong" }));
    }
    expect(s.server.state().terminals[0]?.status).toBe("connected");
  });

  it("a second connection for the same device replaces the first, and the charge goes to the second", async () => {
    const s = await station([POS]);
    const first = await terminal(s.url, "pos-1", POS.secret);
    const second = await terminal(s.url, "pos-1", POS.secret);
    expect(await first.closed).toMatchObject({ code: CLOSE.replaced });
    expect(s.server.state().terminals[0]?.status).toBe("connected");
    const answer = s.server.charge(LEG);
    expect(answer.ok).toBe(true);
    expect((await second.next()).type).toBe("charge");
  });
});

describe("the links", () => {
  it("re-read after a re-pair that rotates the secret: the old session is closed", async () => {
    let links = [POS];
    const s = await station([], { source: async () => links });
    const t = await terminal(s.url, "pos-1", POS.secret);
    links = [link("pos-1")];
    expect(await s.server.refreshLinks()).toBe(true);
    expect(await t.closed).toMatchObject({ code: CLOSE.unlinked });
    expect(s.server.state().terminals[0]?.status).toBe("disconnected");
  });

  it("survive the server down: kept sealed on disk, read back on the next start, and kept when the source fails", async () => {
    const cache = memoryCache();
    const sealer = fakeSealer();
    const first = await station([POS], { cache, sealer });
    expect(cache.disk.links).toEqual([{ deviceId: "pos-1", provider: "PAGBANK", lanAddress: null, sealedSecret: sealer.sealed[0] }]);
    expect(JSON.stringify(cache.disk.links)).not.toContain(POS.secret);
    await first.server.stop();

    const down = async (): Promise<never> => {
      throw new Error("the server is down");
    };
    const s = await station([], { cache, sealer, source: down });
    expect(await s.server.refreshLinks()).toBe(false);
    await terminal(s.url, "pos-1", POS.secret);
    expect(s.server.state().terminals[0]?.status).toBe("connected");
  });

  it("seal the kept links again, once, when the key store asks for it on start", async () => {
    const before = memoryCache();
    await (await station([POS], { cache: before, sealer: fakeSealer() })).server.stop();
    const writes: number[] = [];
    const cache = { ...memoryCache(before.disk.links), write: async () => void writes.push(writes.length) };
    const down = async (): Promise<never> => {
      throw new Error("the server is down");
    };
    const s = await station([], { cache, sealer: fakeSealer(true, { reseal: true }), source: down });
    expect(await s.server.refreshLinks()).toBe(false);
    expect(writes).toHaveLength(1);
    await terminal(s.url, "pos-1", POS.secret);
    expect(s.server.state().terminals[0]?.status).toBe("connected");
  });

  it("start nothing when stopped while the key store was still answering", async () => {
    const gate: { answer: (value: boolean) => void } = { answer: () => undefined };
    const events: unknown[] = [];
    const slow = { ...fakeSealer(), available: () => new Promise<boolean>((resolve) => (gate.answer = resolve)) };
    const server = createTerminalLinkServer({
      listen: wsListen,
      stationId: () => "station-1",
      source: async () => [POS],
      cache: memoryCache(),
      sealer: slow,
      interfaces: () => ({}),
      hosts: ["127.0.0.1"],
      port: 0,
      pingIntervalMs: 60_000,
      onEvent: (event) => events.push(event),
    });
    const starting = server.start();
    await server.stop();
    gate.answer(true);
    await starting;
    expect(server.addresses()).toEqual([]);
    // No state announced (and no heartbeat set) by a start that lost to its stop.
    expect(events).toEqual([]);
  });

  it("write no secret to disk when the key store is not available", async () => {
    const cache = memoryCache();
    await station([POS], { cache, sealer: fakeSealer(false) });
    expect(cache.disk.links).toEqual([]);
  });
});

describe("where the station listens", () => {
  const nic = (address: string, extra: Partial<InterfaceAddress> = {}): InterfaceAddress => ({ address, family: "IPv4", internal: false, ...extra });

  it("binds only the private IPv4 interfaces, never a public one, loopback, IPv6 or 0.0.0.0", () => {
    expect(
      privateBindAddresses({
        lo: [nic("127.0.0.1", { internal: true }), nic("::1", { family: "IPv6", internal: true })],
        eth0: [nic("192.168.0.20"), nic("fe80::1", { family: "IPv6" })],
        wlan0: [nic("10.1.2.3")],
        wan: [nic("200.150.10.4")],
        docker0: [nic("172.17.0.1")],
        apipa: [nic("169.254.10.10")],
        cgnat: [nic("100.64.0.5")],
      }),
    ).toEqual(["192.168.0.20", "10.1.2.3", "172.17.0.1", "169.254.10.10"]);
  });

  it("finds nothing to bind on a machine with only public and loopback addresses", () => {
    expect(privateBindAddresses({ lo: [nic("127.0.0.1", { internal: true })], wan: [nic("200.150.10.4")] })).toEqual([]);
  });

  it.each([
    ["10.0.0.1", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],
    ["172.15.0.1", false],
    ["192.168.1.1", true],
    ["192.169.1.1", false],
    ["169.254.1.1", true],
    ["0.0.0.0", false],
    ["8.8.8.8", false],
    ["10.0.0.256", false],
    ["not-an-ip", false],
  ])("isPrivateIpv4(%s) is %s", (address, expected) => {
    expect(isPrivateIpv4(address)).toBe(expected);
  });
});
