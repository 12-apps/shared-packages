import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaptureTrace } from "../../terminal-link";
import type { InterfaceAddress, NetworkInterfaces } from "../terminal-bind";
import type { TerminalEvent } from "../terminal-contract";
import { CLOSE } from "../terminal-link-api";
import type { TerminalLink } from "../terminal-link-cache";
import { connectTerminal, link, startStation, type FakeTerminal, type Station } from "./harness";

/**
 * The station's LAN server, hardened (ported from the origin host): a charge's life past
 * its session, late approvals, the listen addresses moving, and the frames and
 * connections the server must refuse before it reads them. A REAL `ws` client
 * on 127.0.0.1 plays the terminal, as in `terminal-link.test.ts`.
 */

const open: { stations: Station[]; terminals: FakeTerminal[]; blockers: Server[] } = { stations: [], terminals: [], blockers: [] };

afterEach(async () => {
  for (const terminal of open.terminals.splice(0)) terminal.socket.terminate();
  await Promise.all(open.stations.splice(0).map((station) => station.server.stop()));
  await Promise.all(open.blockers.splice(0).map((blocker) => new Promise<void>((resolve) => blocker.close(() => resolve()))));
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

const disconnected = (event: TerminalEvent): boolean => event.kind === "state" && event.state.terminals[0]?.status === "disconnected";

/** A charge pushed to a connected terminal, received there. */
async function charged(s: Station, t: FakeTerminal, request: Parameters<Station["server"]["charge"]>[0] = LEG): Promise<string> {
  const answer = s.server.charge(request);
  if (!answer.ok) throw new Error(`not charged: ${answer.code}`);
  expect(await t.next()).toMatchObject({ type: "charge", chargeId: answer.chargeId });
  return answer.chargeId;
}

/** Drop the terminal's connection and wait until the station reads it as gone. */
async function dropTerminal(s: Station, t: FakeTerminal): Promise<void> {
  const before = s.events.length;
  t.socket.terminate();
  await vi.waitFor(() => expect(s.events.slice(before).some(disconnected)).toBe(true));
}

describe("a pending charge outlives its session (B2)", () => {
  it("a page that reloaded finds the pending charge in the state, and cancels it", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const chargeId = await charged(s, t, { ...LEG, part: 1, parts: 2, remainingCents: 6360 });
    // The reloaded page has nothing but `state()`.
    const pending = s.server.state().terminals[0]?.pending;
    expect(pending).toEqual({ chargeId, amountCents: 6490, method: "DEBIT", part: 1, parts: 2 });
    expect(s.server.cancel(pending!.chargeId)).toBe("SENT");
    expect(await t.next()).toMatchObject({ type: "cancel", chargeId });
  });

  it("a disconnect mid-charge keeps the charge pending and the device busy; the terminal's answer on its next session still lands", async () => {
    const s = await station([POS]);
    const first = await terminal(s.url, "pos-1", POS.secret);
    const chargeId = await charged(s, first);
    await dropTerminal(s, first);
    expect(s.server.state().terminals[0]).toMatchObject({ status: "disconnected", pending: { chargeId } });
    expect(s.server.charge(LEG)).toEqual({ ok: false, code: "BUSY" });

    const second = await terminal(s.url, "pos-1", POS.secret);
    second.send(second.peer.seal({ type: "status", chargeId, state: "approved", capture: CAPTURE }));
    expect(await s.event((event) => event.kind === "status" && event.chargeId === chargeId)).toMatchObject({ state: "approved", capture: CAPTURE });
    expect(s.server.state().terminals[0]?.pending).toBeNull();
    expect(s.server.charge(LEG).ok).toBe(true);
  });

  it("cancel while the terminal is away frees the device and says the outcome is unknown", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const chargeId = await charged(s, t);
    await dropTerminal(s, t);
    expect(s.server.cancel(chargeId)).toBe("OUTCOME_UNKNOWN");
    expect(s.events).toContainEqual({ kind: "charge-released", deviceId: "pos-1", chargeId, reason: "cancelled-away", outcome: "unknown" });
    expect(s.server.state().terminals[0]?.pending).toBeNull();
    // Free: the refusal is now that it is away, not that it is busy.
    expect(s.server.charge(LEG)).toEqual({ ok: false, code: "NOT_CONNECTED" });
    expect(s.server.cancel(chargeId)).toBe("NO_CHARGE");
  });

  it("a re-pair mid-charge releases the charge with an event", async () => {
    let links: TerminalLink[] = [POS];
    const s = await station([], { source: async () => links });
    const t = await terminal(s.url, "pos-1", POS.secret);
    const chargeId = await charged(s, t);
    links = [link("pos-1")];
    expect(await s.server.refreshLinks()).toBe(true);
    expect(s.events).toContainEqual({ kind: "charge-released", deviceId: "pos-1", chargeId, reason: "repaired", outcome: "unknown" });
    expect(s.server.state().terminals[0]?.pending).toBeNull();
    expect(s.server.charge(LEG)).toEqual({ ok: false, code: "NOT_CONNECTED" });
  });

  it("an unlink mid-charge, even with the terminal away, releases the charge with an event", async () => {
    let links: TerminalLink[] = [POS];
    const s = await station([], { source: async () => links });
    const t = await terminal(s.url, "pos-1", POS.secret);
    const chargeId = await charged(s, t);
    await dropTerminal(s, t);
    links = [];
    expect(await s.server.refreshLinks()).toBe(true);
    expect(s.events).toContainEqual({ kind: "charge-released", deviceId: "pos-1", chargeId, reason: "unlinked", outcome: "unknown" });
  });

  it("stopping the station releases the pending charge", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const chargeId = await charged(s, t);
    await s.server.stop();
    expect(s.events).toContainEqual({ kind: "charge-released", deviceId: "pos-1", chargeId, reason: "stopped", outcome: "unknown" });
    expect(await t.closed).toMatchObject({ code: CLOSE.goingAway });
  });
});

describe("a late answer for a released charge (B3)", () => {
  it("an approval or a method change for a charge cancelled while away is an orphan capture; other states and never-sent charges are ignored", async () => {
    const s = await station([POS]);
    const away = await terminal(s.url, "pos-1", POS.secret);
    const chargeId = await charged(s, away);
    await dropTerminal(s, away);
    expect(s.server.cancel(chargeId)).toBe("OUTCOME_UNKNOWN");

    const back = await terminal(s.url, "pos-1", POS.secret);
    back.send(back.peer.seal({ type: "status", chargeId, state: "declined" }));
    back.send(back.peer.seal({ type: "status", chargeId: "never-sent", state: "approved", capture: CAPTURE }));
    back.send(back.peer.seal({ type: "status", chargeId, state: "method_changed", method: "PIX" }));
    back.send(back.peer.seal({ type: "status", chargeId, state: "approved", capture: CAPTURE }));
    await s.event((event) => event.kind === "orphan-capture" && event.state === "approved");
    expect(s.events.filter((event) => event.kind === "orphan-capture" || event.kind === "status")).toEqual([
      { kind: "orphan-capture", deviceId: "pos-1", chargeId, state: "method_changed", method: "PIX" },
      { kind: "orphan-capture", deviceId: "pos-1", chargeId, state: "approved", capture: CAPTURE },
    ]);
  });

  it("an approval that loses the race with the terminal's own cancel or move to cash is an orphan capture", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const cashed = await charged(s, t);
    t.send(t.peer.seal({ type: "status", chargeId: cashed, state: "method_changed", method: "CASH" }));
    await s.event((event) => event.kind === "status" && event.chargeId === cashed);
    const cancelled = await charged(s, t);
    t.send(t.peer.seal({ type: "status", chargeId: cancelled, state: "cancelled" }));
    await s.event((event) => event.kind === "status" && event.chargeId === cancelled);

    // The acquirer answered after the terminal said so: the buyer paid.
    t.send(t.peer.seal({ type: "status", chargeId: cashed, state: "approved", capture: CAPTURE }));
    t.send(t.peer.seal({ type: "status", chargeId: cancelled, state: "approved", capture: CAPTURE }));
    await s.event((event) => event.kind === "orphan-capture" && event.chargeId === cancelled);
    expect(s.events.filter((event) => event.kind === "orphan-capture")).toEqual([
      { kind: "orphan-capture", deviceId: "pos-1", chargeId: cashed, state: "approved", capture: CAPTURE },
      { kind: "orphan-capture", deviceId: "pos-1", chargeId: cancelled, state: "approved", capture: CAPTURE },
    ]);
    // No charge-released for either: the page heard the terminal's own status.
    expect(s.events.some((event) => event.kind === "charge-released")).toBe(false);
  });

  it("another device's approval for a charge released from this one is ignored", async () => {
    const other = link("pos-2");
    let links: TerminalLink[] = [POS];
    const s = await station([], { source: async () => links });
    const t = await terminal(s.url, "pos-1", POS.secret);
    const chargeId = await charged(s, t);
    await dropTerminal(s, t);
    s.server.cancel(chargeId);
    links = [other];
    await s.server.refreshLinks();
    const intruder = await terminal(s.url, "pos-2", other.secret);
    intruder.send(intruder.peer.seal({ type: "status", chargeId, state: "approved", capture: CAPTURE }));
    intruder.send(intruder.peer.seal({ type: "typed_captures", captures: [CAPTURE] }));
    await s.event((event) => event.kind === "typed-captures");
    expect(s.events.some((event) => event.kind === "orphan-capture")).toBe(false);
  });
});

describe("where the station listens, as the machine's addresses move (B4)", () => {
  const nic = (address: string): InterfaceAddress => ({ address, family: "IPv4", internal: false });
  // Loopback stands in for the store's LAN here: the private filter has its own tests.
  const everyAddress = (interfaces: NetworkInterfaces): string[] => Object.values(interfaces).flatMap((entries) => (entries ?? []).map((entry) => entry.address));

  it("listens on an address that appears after the start, and stops on one that vanished", async () => {
    let interfaces: NetworkInterfaces = {};
    const s = await station([POS], { hosts: undefined, pickHosts: everyAddress, interfaces: () => interfaces, pingIntervalMs: 20 });
    expect(s.server.addresses()).toEqual([]);

    interfaces = { eth0: [nic("127.0.0.1")] };
    await s.server.refreshLinks();
    expect(s.server.addresses()).toEqual([expect.stringMatching(/^127\.0\.0\.1:\d+$/)]);
    await terminal(`ws://${s.server.addresses()[0]}`, "pos-1", POS.secret);

    // The lease moved: the heartbeat tick follows it.
    interfaces = { eth0: [nic("127.0.0.2")] };
    await vi.waitFor(() => expect(s.server.addresses()).toEqual([expect.stringMatching(/^127\.0\.0\.2:\d+$/)]));
    expect(s.server.state().listening).toEqual(s.server.addresses());
  });

  it("logs a listen that failed, and listens once the port is free (N2)", async () => {
    const blocker = createServer();
    open.blockers.push(blocker);
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", () => resolve()));
    const port = (blocker.address() as { port: number }).port;
    const log = vi.fn();
    const s = await station([POS], { port, log });
    expect(s.server.addresses()).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not listen on 127\.0\.0\.1/));

    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await s.server.refreshLinks();
    expect(s.server.addresses()).toEqual([`127.0.0.1:${port}`]);
  });
});

describe("frames refused before they are read (B5, N1)", () => {
  it("a binary frame is closed with 4400", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    t.socket.send(Buffer.from(t.peer.seal({ type: "pong" })), { binary: true });
    expect(await t.closed).toMatchObject({ code: CLOSE.malformed, reason: "text only" });
  });

  it("a frame over 64 KB is closed by the payload cap (1009) before it is parsed", async () => {
    const log = vi.fn();
    const s = await station([POS], { log });
    const t = await terminal(s.url, "pos-1", POS.secret);
    t.send("x".repeat(64 * 1024 + 1));
    expect((await t.closed).code).toBe(1009);
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/refused a frame/));
  });

  it("a stale hello, by the station's clock, is refused with 4401", async () => {
    // A station clock years ahead of the terminal's: far past the skew window.
    const s = await station([POS], { now: () => Date.parse("2099-01-01T00:00:00.000Z") });
    const t = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    t.send(t.peer.hello());
    expect(await t.closed).toMatchObject({ code: CLOSE.refused, reason: "stale" });
  });

  it("frames that follow a refused one, on the closing socket, are not admitted", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    const pong = t.peer.seal({ type: "pong" });
    t.send(pong);
    t.send(pong); // replayed: the station closes
    t.send(t.peer.seal({ type: "typed_captures", captures: [CAPTURE] }));
    expect(await t.closed).toMatchObject({ code: CLOSE.refused, reason: "replayed" });
    expect(s.events.some((event) => event.kind === "typed-captures")).toBe(false);
  });

  it("a hello that follows a refused first frame is not admitted", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    t.send("not json");
    t.send(t.peer.hello());
    expect(await t.closed).toMatchObject({ code: CLOSE.malformed });
    expect(s.events.some((event) => event.kind === "state" && event.state.terminals[0]?.status === "connected")).toBe(false);
  });
});

describe("connections the station refuses (N3, N10)", () => {
  it("caps the connections waiting on their hello; one past the cap is closed, and a slot frees once a hello is in", async () => {
    const s = await station([POS], { maxPendingHandshakes: 2 });
    const first = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    await terminal(s.url, "pos-1", POS.secret, { hello: false });
    const third = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    expect(await third.closed).toMatchObject({ code: CLOSE.busy });

    first.send(first.peer.hello());
    expect((await first.next()).type).toBe("hello");
    const fourth = await terminal(s.url, "pos-1", POS.secret);
    expect(fourth.peer.sid).not.toBeNull();
  });

  it("a computer with no station id refuses the hello, and says so apart from an unknown device", async () => {
    const log = vi.fn();
    const s = await station([POS], { stationId: () => null, log });
    const t = await terminal(s.url, "pos-1", POS.secret, { hello: false });
    t.send(t.peer.hello());
    expect(await t.closed).toMatchObject({ code: CLOSE.noStation, reason: "no station id" });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/no station id yet/));
    expect(log).not.toHaveBeenCalledWith(expect.stringMatching(/unknown device/));
  });
});

describe("the links source (N4)", () => {
  it("asks one refresh after another, so an older answer never overwrites a newer one", async () => {
    const asked: ((links: TerminalLink[]) => void)[] = [];
    let held = false;
    // The start's own refresh, and the harness's, answer at once; from then on each answer is held.
    const s = await station([], {
      source: async () => (held ? new Promise<TerminalLink[]>((resolve) => asked.push(resolve)) : []),
    });
    held = true;

    const older = s.server.refreshLinks();
    const newer = s.server.refreshLinks();
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    // Only the first is asked while it is pending.
    await new Promise((resolve) => setImmediate(resolve));
    expect(asked).toHaveLength(1);
    asked.shift()!([link("old")]);
    await older;
    await vi.waitFor(() => expect(asked).toHaveLength(1));
    asked.shift()!([POS]);
    await newer;
    expect(s.server.state().terminals.map((entry) => entry.deviceId)).toEqual(["pos-1"]);
  });

  it("keeps the kept links when the source rejects", async () => {
    let fail = false;
    const s = await station([], {
      source: async () => {
        if (fail) throw new Error("not wired");
        return [POS];
      },
    });
    await s.server.refreshLinks();
    fail = true;
    expect(await s.server.refreshLinks()).toBe(false);
    expect(s.server.state().terminals.map((entry) => entry.deviceId)).toEqual(["pos-1"]);
  });
});

describe("the typed-capture acknowledgement (N9)", () => {
  it("reaches the terminal only when asked, and not when the terminal is away", async () => {
    const s = await station([POS]);
    const t = await terminal(s.url, "pos-1", POS.secret);
    t.send(t.peer.seal({ type: "typed_captures", captures: [CAPTURE] }));
    await s.event((event) => event.kind === "typed-captures");
    // Receiving the captures acknowledges nothing: the page books first.
    expect(t.frames).toHaveLength(1);
    expect(s.server.ackTyped("pos-1", ["TX-0001"])).toBe(true);
    expect(await t.next()).toMatchObject({ type: "typed_ack", transactionCodes: ["TX-0001"] });
    expect(s.server.ackTyped("pos-9", ["TX-0001"])).toBe(false);
  });
});
