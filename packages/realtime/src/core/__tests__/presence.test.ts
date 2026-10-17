import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createInlineRealtimeDriver } from "../../drivers/inline";
import {
  PRESENCE_TOPIC,
  PresenceTracker,
  isValidPresenceKey,
  isValidPresenceList,
  presenceChangesOf,
  PRESENCE_EVENT_MAX_KEYS,
  type PresenceChange,
} from "../presence";
import { subscribePresence } from "../presence-listener";
import { configureRealtime, resetRealtimeRuntime } from "../runtime";
import { mintRealtimeTicket, verifyRealtimeTicket } from "../ticket";

/**
 * Presence that lasts exactly as long as a connection.
 *
 * The property every case defends: a key is HELD from the moment its first
 * connection opens to the moment its last one closes, is renewed from the server in
 * between with no request from any browser, and is never announced for a connection
 * that never held it. The listener half must hand one key's changes over in order,
 * because "left" overtaken by "arrived" reads as somebody still here.
 */

const SECRET = "presence-secret";
const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** A frozen clock: the flakiness gate forbids `Date.now()` in a test body. */
const NOW_SECONDS = 1_767_225_600;

/** One publish the tracker made, decoded — what a host listener would be handed. */
function announced(driver: ReturnType<typeof createInlineRealtimeDriver>): PresenceChange[] {
  return driver.published
    .filter((record) => record.topic === PRESENCE_TOPIC)
    .flatMap((record) => presenceChangesOf(record.event));
}

/** Forget what the bus recorded so far — a named helper, for the flakiness gate. */
function forget(driver: ReturnType<typeof createInlineRealtimeDriver>): void {
  driver.clearPublished();
}

/** A tracker over a fresh inline bus, so every case reads its own wire. */
function trackerOnBus(renewMs = 10_000) {
  const driver = createInlineRealtimeDriver({ logger: silentLogger });
  configureRealtime({ driver, logger: silentLogger });
  return { driver, tracker: new PresenceTracker({ renewMs, logger: silentLogger }) };
}

/** Wait for the tracker's fire-and-forget publishes and the listener's chains. */
async function settle(): Promise<void> {
  for (let drain = 0; drain < 25; drain += 1) await Promise.resolve();
}

afterEach(() => {
  resetRealtimeRuntime();
  vi.useRealTimers();
});

describe("presence keys", () => {
  it("admits a host's opaque key and refuses whitespace, reserved and oversized ones", () => {
    expect(isValidPresenceKey("seat:t-1:s-1:p-1")).toBe(true);
    expect(isValidPresenceKey("seat 1")).toBe(false);
    expect(isValidPresenceKey("$presence")).toBe(false);
    expect(isValidPresenceKey("")).toBe(false);
    expect(isValidPresenceKey("k".repeat(201))).toBe(false);
    expect(isValidPresenceKey(42)).toBe(false);
  });

  it("caps how many keys one connection may hold", () => {
    expect(isValidPresenceList(["a", "b", "c", "d"])).toBe(true);
    expect(isValidPresenceList(["a", "b", "c", "d", "e"])).toBe(false);
    expect(isValidPresenceList("a")).toBe(false);
  });
});

describe("the ticket carries presence beside the topics", () => {
  it("signs the keys in and hands them back verified", () => {
    const ticket = mintRealtimeTicket(["tenant:t-1:comanda:s-1"], SECRET, NOW_SECONDS, {
      presence: ["seat:t-1:s-1:p-1"],
    });
    expect(verifyRealtimeTicket(ticket, SECRET, NOW_SECONDS)?.presence).toEqual([
      "seat:t-1:s-1:p-1",
    ]);
  });

  it("holds nothing when the host named nothing — and an older ticket reads the same", () => {
    const ticket = mintRealtimeTicket(["tenant:t-1:kitchen"], SECRET, NOW_SECONDS);
    expect(verifyRealtimeTicket(ticket, SECRET, NOW_SECONDS)?.presence).toEqual([]);
  });

  it("refuses to mint a malformed key or a reserved topic", () => {
    expect(() =>
      mintRealtimeTicket(["tenant:t-1:kitchen"], SECRET, NOW_SECONDS, { presence: ["a b"] }),
    ).toThrow(/presence/);
    expect(() => mintRealtimeTicket([PRESENCE_TOPIC], SECRET, NOW_SECONDS)).toThrow(/reserved/);
  });

  it("refuses to VERIFY a signed reserved topic, so no socket can hear the presence bus", () => {
    // Forged with the right secret, as a minting bug would: the verify must still refuse.
    const body = Buffer.from(
      JSON.stringify({ t: [PRESENCE_TOPIC], e: NOW_SECONDS + 30, n: "nonce" }),
    ).toString("base64url");
    const signature = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyRealtimeTicket(`${body}.${signature}`, SECRET, NOW_SECONDS)).toBeNull();
  });
});

describe("PresenceTracker — held for the connections' lifetime, refcounted", () => {
  it("announces HELD on the first connection and RELEASED only when the last one closes", async () => {
    const { driver, tracker } = trackerOnBus();
    const firstTab = tracker.hold(["seat:k"]);
    const secondTab = tracker.hold(["seat:k"]);
    await settle();
    expect(announced(driver)).toEqual([{ key: "seat:k", state: "held" }]);

    firstTab();
    await settle();
    expect(announced(driver)).toHaveLength(1);

    secondTab();
    await settle();
    expect(announced(driver)).toEqual([
      { key: "seat:k", state: "held" },
      { key: "seat:k", state: "released" },
    ]);
    expect(tracker.size).toBe(0);
  });

  it("releases once however many exit paths call the release", async () => {
    const { driver, tracker } = trackerOnBus();
    const release = tracker.hold(["seat:k"]);
    release();
    release();
    await settle();
    expect(announced(driver).filter((change) => change.state === "released")).toHaveLength(1);
  });

  it("announces nothing for a connection that holds no key", async () => {
    const { driver, tracker } = trackerOnBus();
    tracker.hold([])();
    await settle();
    expect(driver.published).toEqual([]);
  });

  it("renews every held key from the server, and stops renewing once nothing is held", async () => {
    vi.useFakeTimers();
    const { driver, tracker } = trackerOnBus(1_000);
    const release = tracker.hold(["seat:a", "viewer:a"]);
    await settle();
    forget(driver);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(announced(driver)).toEqual([
      { key: "seat:a", state: "held" },
      { key: "viewer:a", state: "held" },
      { key: "seat:a", state: "held" },
      { key: "viewer:a", state: "held" },
    ]);

    release();
    await settle();
    forget(driver);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(driver.published).toEqual([]);
  });

  it("releases every key on shutdown, before the bus goes", async () => {
    const { driver, tracker } = trackerOnBus();
    const release = tracker.hold(["seat:a"]);
    tracker.hold(["seat:b"]);
    await tracker.releaseAll();
    expect(announced(driver).filter((change) => change.state === "released")).toEqual([
      { key: "seat:a", state: "released" },
      { key: "seat:b", state: "released" },
    ]);
    // A socket whose close event lands after the shutdown says nothing twice.
    release();
    await settle();
    expect(announced(driver).filter((change) => change.state === "released")).toHaveLength(2);
  });

  it("names its holder on every event, so listeners can merge processes", async () => {
    const { driver, tracker } = trackerOnBus();
    tracker.hold(["seat:k"]);
    await settle();
    const data = driver.published.find((record) => record.topic === PRESENCE_TOPIC)?.event.data;
    expect(data).toEqual({ keys: ["seat:k"], holder: tracker.holder });
  });

  it("chunks a large renewal so no bus event carries more than the cap", async () => {
    vi.useFakeTimers();
    const { driver, tracker } = trackerOnBus(1_000);
    for (let seat = 0; seat < 450; seat += 1) tracker.hold([`seat:${seat}`]);
    await settle();
    forget(driver);
    await vi.advanceTimersByTimeAsync(1_000);
    const sizes = driver.published.map((record) => (record.event.data as { keys: string[] }).keys.length);
    expect(sizes).toEqual([PRESENCE_EVENT_MAX_KEYS, PRESENCE_EVENT_MAX_KEYS, 50]);
  });

  it("never throws into the connection when the bus is gone", async () => {
    resetRealtimeRuntime();
    const tracker = new PresenceTracker({ logger: silentLogger });
    expect(() => tracker.hold(["seat:a"])()).not.toThrow();
    await expect(tracker.flush()).resolves.toBeUndefined();
  });
});

describe("subscribePresence — the host's listener", () => {
  it("hears every holder's changes, one key in order even when the handler is slow", async () => {
    const { tracker } = trackerOnBus();
    const written: string[] = [];
    const gates: (() => void)[] = [];
    await subscribePresence(
      (change) =>
        new Promise<void>((resolve) => {
          gates.push(() => {
            written.push(`${change.key}:${change.state}`);
            resolve();
          });
        }),
      silentLogger,
      { releaseGraceMs: 0 },
    );

    tracker.hold(["seat:k"])();
    await settle();
    // The HELD handler is still running; the RELEASED one must wait behind it.
    expect(gates).toHaveLength(1);
    gates[0]?.();
    await settle();
    gates[1]?.();
    await settle();
    expect(written).toEqual(["seat:k:held", "seat:k:released"]);
  });

  it("keeps listening after a handler throws", async () => {
    const { tracker } = trackerOnBus();
    const errors: unknown[] = [];
    const seen: string[] = [];
    await subscribePresence(
      (change) => {
        seen.push(change.state);
        if (change.state === "held") throw new Error("host write failed");
      },
      { ...silentLogger, error: (_message: string, error?: unknown) => errors.push(error) },
      { releaseGraceMs: 0 },
    );
    tracker.hold(["seat:k"])();
    await settle();
    expect(seen).toEqual(["held", "released"]);
    expect(errors).toHaveLength(1);
  });

  it("ignores a malformed event on the reserved topic", () => {
    expect(presenceChangesOf({ type: "presence.held", data: { keys: ["ok", "not ok"] }, ts: 0, id: "x" })).toEqual([
      { key: "ok", state: "held" },
    ]);
    expect(presenceChangesOf({ type: "other", data: { keys: ["ok"] }, ts: 0, id: "x" })).toEqual([]);
    expect(presenceChangesOf({ type: "presence.held", data: null, ts: 0, id: "x" })).toEqual([]);
  });
});
