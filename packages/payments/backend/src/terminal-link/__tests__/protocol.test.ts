import { describe, expect, it } from "vitest";

import { utf8 } from "../encoding";
import { readMessage, type CaptureTrace } from "../messages";
import { canonicalJson, createLinkPeer, createNonceMemory, macOf, type LinkPeer } from "../peer";

/**
 * The station↔terminal LAN protocol: each refusal the
 * station or the terminal makes, one case each.
 */

const KEY = utf8("link-secret-of-device-1");
const NOW = Date.parse("2026-11-03T15:00:00.000Z");
let counter = 0;
const nonce = () => (++counter).toString(16).padStart(32, "0");

function pair(options: { now?: () => number } = {}): { station: LinkPeer<"station">; terminal: LinkPeer<"terminal"> } {
  const clock = options.now ?? (() => NOW);
  const stationPeer = createLinkPeer("station", { key: KEY, identity: "station-1", nonce, now: clock });
  const terminalPeer = createLinkPeer("terminal", { key: KEY, identity: "device-1", nonce, now: clock });
  expect(stationPeer.open(terminalPeer.hello()).ok).toBe(true);
  expect(terminalPeer.open(stationPeer.hello()).ok).toBe(true);
  return { station: stationPeer, terminal: terminalPeer };
}

/** Re-sign a frame after changing it, as a sender holding the key would. */
function resign(raw: string, change: (record: Record<string, unknown>) => void, key = KEY): string {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  change(parsed);
  return JSON.stringify({ ...parsed, mac: macOf(parsed, key) });
}

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

describe("the handshake", () => {
  it("opens one session both sides agree on, and carries a charge and its approval", () => {
    const { station, terminal } = pair();
    expect(station.sid).not.toBeNull();
    expect(terminal.sid).toBe(station.sid);
    const charge = terminal.open(
      station.seal({ type: "charge", chargeId: "c-1", saleRef: "5532", operator: "Cláudia Rangel", amountCents: 6490, method: "DEBIT", part: 1, parts: 2, remainingCents: 6360 }),
    );
    expect(charge).toMatchObject({ ok: true, message: { type: "charge", amountCents: 6490, part: 1, parts: 2 } });
    const status = station.open(terminal.seal({ type: "status", chargeId: "c-1", state: "approved", capture: CAPTURE }));
    expect(status).toMatchObject({ ok: true, message: { type: "status", state: "approved", capture: CAPTURE } });
  });

  it("refuses a station hello that does not echo the terminal's nonce", () => {
    const terminal = createLinkPeer("terminal", { key: KEY, identity: "device-1", nonce, now: () => NOW });
    const station = createLinkPeer("station", { key: KEY, identity: "station-1", nonce, now: () => NOW });
    // A station hello answering an EARLIER terminal hello (a replay of an old session's answer).
    const old = createLinkPeer("terminal", { key: KEY, identity: "device-1", nonce, now: () => NOW });
    station.open(old.hello());
    const staleAnswer = station.hello();
    terminal.hello();
    expect(terminal.open(staleAnswer)).toMatchObject({ ok: false, refusal: "session" });
  });

  it("refuses a second hello inside a session", () => {
    const { station } = pair();
    const intruder = createLinkPeer("terminal", { key: KEY, identity: "device-1", nonce, now: () => NOW });
    // Its n is 1: the counter refuses it first; one that also jumps the counter is still not a session frame.
    const second = resign(intruder.hello(), (record) => (record.n = 99));
    expect(station.open(second)).toMatchObject({ ok: false, refusal: "session" });
  });

  it("will not seal before the session is open", () => {
    const station = createLinkPeer("station", { key: KEY, identity: "station-1", nonce });
    expect(() => station.seal({ type: "ping" })).toThrow(/no session/);
    expect(() => station.hello()).toThrow(/answers the terminal/);
  });
});

describe("what the receiver refuses", () => {
  it("a frame that is not JSON, or not an object", () => {
    const { station } = pair();
    expect(station.open("{nope")).toMatchObject({ ok: false, refusal: "malformed" });
    expect(station.open("[1,2]")).toMatchObject({ ok: false, refusal: "malformed" });
    expect(station.open("null")).toMatchObject({ ok: false, refusal: "malformed" });
  });

  it("another protocol version", () => {
    const { station, terminal } = pair();
    expect(station.open(resign(terminal.seal({ type: "pong" }), (record) => (record.v = 2)))).toMatchObject({ ok: false, refusal: "version" });
  });

  it("a type outside its direction's vocabulary", () => {
    const { station, terminal } = pair();
    // `ping` is the station's word; the terminal answers `pong`.
    expect(station.open(resign(terminal.seal({ type: "pong" }), (record) => (record.type = "ping")))).toMatchObject({ ok: false, refusal: "unknown-type" });
    expect(terminal.open(resign(station.seal({ type: "ping" }), (record) => (record.type = "status")))).toMatchObject({ ok: false, refusal: "unknown-type" });
  });

  it("an unknown key, even correctly signed", () => {
    const { station, terminal } = pair();
    const raw = resign(terminal.seal({ type: "status", chargeId: "c-1", state: "declined" }), (record) => (record.cardNumber = "4111"));
    expect(station.open(raw)).toMatchObject({ ok: false, refusal: "unknown-key", detail: "cardNumber" });
    const capture = resign(terminal.seal({ type: "status", chargeId: "c-1", state: "approved", capture: CAPTURE }), (record) => {
      record.capture = { ...CAPTURE, pan: "4111" };
    });
    expect(station.open(capture)).toMatchObject({ ok: false, refusal: "bad-field", detail: "capture" });
  });

  it("a missing key", () => {
    const { station, terminal } = pair();
    const raw = resign(station.seal({ type: "cancel", chargeId: "c-1" }), (record) => delete record.chargeId);
    expect(terminal.open(raw)).toMatchObject({ ok: false, refusal: "missing-key", detail: "chargeId" });
  });

  it.each([
    ["a fractional amount", { amountCents: 64.9 }, "amountCents"],
    ["a zero amount", { amountCents: 0 }, "amountCents"],
    ["an amount as text", { amountCents: "6490" }, "amountCents"],
    ["cash pushed to the terminal", { method: "CASH" }, "method"],
    ["a part past the split cap", { part: 7, parts: 7 }, "part"],
    ["a part without parts", { part: 1 }, "part"],
    ["a part beyond its parts", { part: 3, parts: 2 }, "part"],
    ["a remainder with no split", { remainingCents: 100 }, "remainingCents"],
    ["an operator with a control character", { operator: "Ana\u0007" }, "operator"],
    ["a charge id with a space", { chargeId: "c 1" }, "chargeId"],
  ])("a charge with %s", (_label, change, detail) => {
    const { station, terminal } = pair();
    const raw = resign(station.seal({ type: "charge", chargeId: "c-1", saleRef: "5532", operator: "Ana", amountCents: 6490, method: "CREDIT" }), (record) =>
      Object.assign(record, change),
    );
    expect(terminal.open(raw)).toMatchObject({ ok: false, refusal: "bad-field", detail });
  });

  it.each([
    ["approved with no capture", { state: "approved" }, "capture"],
    ["declined carrying a capture", { state: "declined", capture: CAPTURE }, "capture"],
    ["method_changed with no method", { state: "method_changed" }, "method"],
    ["an unknown state", { state: "paid" }, "state"],
    ["a capture with a bad date", { state: "approved", capture: { ...CAPTURE, capturedAt: "ontem" } }, "capture"],
  ])("a status %s", (_label, change, detail) => {
    const { station, terminal } = pair();
    const raw = resign(terminal.seal({ type: "status", chargeId: "c-1", state: "processing" }), (record) => Object.assign(record, change));
    expect(station.open(raw)).toMatchObject({ ok: false, refusal: "bad-field", detail });
  });

  it("typed captures that are empty or not captures", () => {
    const { station, terminal } = pair();
    const empty = resign(terminal.seal({ type: "typed_captures", captures: [CAPTURE] }), (record) => (record.captures = []));
    expect(station.open(empty)).toMatchObject({ ok: false, refusal: "bad-field", detail: "captures" });
    expect(station.open(terminal.seal({ type: "typed_captures", captures: [CAPTURE, CAPTURE] }))).toMatchObject({ ok: true });
  });

  it("a bad mac: a forged amount, or the right body under another link's secret", () => {
    const { station, terminal } = pair();
    const sealed = JSON.parse(station.seal({ type: "charge", chargeId: "c-1", saleRef: "5532", operator: "Ana", amountCents: 6490, method: "CREDIT" })) as Record<string, unknown>;
    expect(terminal.open(JSON.stringify({ ...sealed, amountCents: 1 }))).toMatchObject({ ok: false, refusal: "bad-mac" });
    const otherKey = resign(JSON.stringify({ ...sealed, n: 50 }), () => undefined, utf8("another link"));
    expect(terminal.open(otherKey)).toMatchObject({ ok: false, refusal: "bad-mac" });
  });

  it("a counter that does not grow: the same frame twice, or an older one", () => {
    const { station, terminal } = pair();
    const first = terminal.seal({ type: "pong" });
    const second = terminal.seal({ type: "pong" });
    expect(station.open(second).ok).toBe(true);
    expect(station.open(second)).toMatchObject({ ok: false, refusal: "replayed" });
    expect(station.open(first)).toMatchObject({ ok: false, refusal: "replayed" });
  });

  it("a stale frame, by the receiver's clock", () => {
    let now = NOW;
    const { station, terminal } = pair({ now: () => now });
    const late = terminal.seal({ type: "pong" });
    now += 5 * 60_000 + 1;
    expect(station.open(late)).toMatchObject({ ok: false, refusal: "stale" });
  });

  it("a frame from another session, even signed with the right secret", () => {
    const first = pair();
    const old = first.terminal.seal({ type: "status", chargeId: "c-1", state: "cancelled" });
    const second = pair();
    expect(second.station.open(old)).toMatchObject({ ok: false, refusal: "session" });
  });

  it("a session frame before the hello", () => {
    const station = createLinkPeer("station", { key: KEY, identity: "station-1", nonce, now: () => NOW });
    const raw = JSON.stringify(
      (() => {
        const record = { v: 1, type: "pong", n: 1, at: NOW, sid: "f".repeat(32) };
        return { ...record, mac: macOf(record, KEY) };
      })(),
    );
    expect(station.open(raw)).toMatchObject({ ok: false, refusal: "session" });
  });
});

describe("keys the prototype knows are still unknown keys (own keys only)", () => {
  const ENVELOPE = { v: 1, n: 1, at: NOW, sid: "a".repeat(32), mac: "0".repeat(64) };

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])("%s at the top level", (key) => {
    const raw = JSON.stringify({ ...ENVELOPE, type: "pong", [key]: "x" });
    expect(readMessage(raw, "terminal")).toMatchObject({ ok: false, refusal: "unknown-key", detail: key });
  });

  it.each(["constructor", "toString", "valueOf", "hasOwnProperty"])("%s inside a capture", (key) => {
    const raw = JSON.stringify({ ...ENVELOPE, type: "status", chargeId: "c-1", state: "approved", capture: { ...CAPTURE, [key]: "x" } });
    expect(readMessage(raw, "terminal")).toMatchObject({ ok: false, refusal: "bad-field", detail: "capture" });
  });

  it("a raw JSON __proto__ key, at the top level and inside a capture", () => {
    // Written by hand: an object literal's `__proto__` sets the prototype, JSON.parse makes an own key.
    const top = `{"v":1,"type":"pong","n":1,"at":${NOW},"sid":"${"a".repeat(32)}","mac":"${"0".repeat(64)}","__proto__":{"x":1}}`;
    expect(readMessage(top, "terminal")).toMatchObject({ ok: false, refusal: "unknown-key", detail: "__proto__" });
    const capture = JSON.stringify(CAPTURE).replace(/^\{/, '{"__proto__":{"x":1},');
    const nested = `{"v":1,"type":"status","n":1,"at":${NOW},"sid":"${"a".repeat(32)}","mac":"${"0".repeat(64)}","chargeId":"c-1","state":"approved","capture":${capture}}`;
    expect(readMessage(nested, "terminal")).toMatchObject({ ok: false, refusal: "bad-field", detail: "capture" });
  });

  it("an optional field named like a prototype key is not taken as present", () => {
    // `"part" in record` would be fine here, but a charge whose split check walked the prototype could not tell.
    const raw = JSON.stringify({ ...ENVELOPE, type: "charge", chargeId: "c-1", saleRef: "1", operator: "Ana", amountCents: 1, method: "PIX" });
    expect(readMessage(raw, "station").ok).toBe(true);
  });
});

describe("text with a lone surrogate", () => {
  it.each([
    ["a high surrogate alone", "Ana \ud83d"],
    ["a low surrogate alone", "\ude00 Ana"],
  ])("is refused: %s", (_label, operator) => {
    const { station, terminal } = pair();
    const raw = resign(station.seal({ type: "charge", chargeId: "c-1", saleRef: "5532", operator: "Ana", amountCents: 6490, method: "CREDIT" }), (record) => (record.operator = operator));
    expect(terminal.open(raw)).toMatchObject({ ok: false, refusal: "bad-field", detail: "operator" });
  });

  it("a paired surrogate (an emoji) is text", () => {
    const { station, terminal } = pair();
    expect(terminal.open(station.seal({ type: "charge", chargeId: "c-1", saleRef: "5532", operator: "Ana \ud83d\ude00", amountCents: 6490, method: "CREDIT" })).ok).toBe(true);
  });
});

describe("typed_ack", () => {
  it("carries the booked transaction codes from the station to the terminal", () => {
    const { station, terminal } = pair();
    expect(terminal.open(station.seal({ type: "typed_ack", transactionCodes: ["TX-0001", "TX-0002"] }))).toMatchObject({
      ok: true,
      message: { type: "typed_ack", transactionCodes: ["TX-0001", "TX-0002"] },
    });
  });

  it.each([
    ["no codes", []],
    ["a code that is not text", [12]],
    ["an empty code", [" "]],
    ["more codes than one batch hands over", Array.from({ length: 51 }, (_, i) => `TX-${i}`)],
  ])("is refused with %s", (_label, transactionCodes) => {
    const { station, terminal } = pair();
    const raw = resign(station.seal({ type: "typed_ack", transactionCodes: ["TX-0001"] }), (record) => (record.transactionCodes = transactionCodes));
    expect(terminal.open(raw)).toMatchObject({ ok: false, refusal: "bad-field", detail: "transactionCodes" });
  });

  it("is the station's word only", () => {
    const { station, terminal } = pair();
    expect(station.open(resign(terminal.seal({ type: "pong" }), (record) => Object.assign(record, { type: "typed_ack", transactionCodes: ["TX-0001"] })))).toMatchObject({
      ok: false,
      refusal: "unknown-type",
    });
  });
});

describe("readMessage", () => {
  it("reads the station's words only as the station's, and the terminal's as the terminal's", () => {
    const record = { v: 1, type: "pong", n: 1, at: NOW, sid: "a".repeat(32), mac: "0".repeat(64) };
    expect(readMessage(JSON.stringify(record), "terminal").ok).toBe(true);
    expect(readMessage(JSON.stringify(record), "station")).toMatchObject({ ok: false, refusal: "unknown-type" });
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth, so the mac does not depend on key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: "x" } })).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
  });
});

describe("the station's hello nonce memory", () => {
  it("refuses a nonce it already accepted until the window passes", () => {
    let now = NOW;
    const memory = createNonceMemory({ now: () => now, ttlMs: 1000 });
    expect(memory.remember("a")).toBe(true);
    expect(memory.remember("a")).toBe(false);
    now += 1001;
    expect(memory.remember("a")).toBe(true);
  });
});
