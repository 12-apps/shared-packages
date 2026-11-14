import { describe, expect, it } from "vitest";

import type { CaptureTrace } from "../../terminal-link";
import { MAX_KEPT, captureWireOf, createLanCaptureBook, type CaptureBookFiles } from "../offline-captures";
import type { TerminalEvent } from "../terminal-contract";

/**
 * The LAN capture book: what the station heard, claimed for one journal entry
 * at a time, durable across a restart. Ported from the origin host's
 * offline-selling suite, at the level of the book itself.
 */

const TRACE: CaptureTrace = {
  transactionCode: "PAG-0001",
  transactionId: "tx-1",
  authorizationCode: "A1",
  brand: "VISA",
  installments: 1,
  serial: "PAX-0001",
  entryMode: "CHIP",
  amountCents: 650,
  kind: "CREDIT",
  capturedAt: "2026-11-04T12:00:00.000Z",
};

const approved = (trace: CaptureTrace = TRACE, deviceId = "device-1"): TerminalEvent => ({
  kind: "status",
  deviceId,
  chargeId: "charge-1",
  state: "approved",
  capture: trace,
});

/** Files in memory, with every replace counted. */
function memoryFiles(initial: Record<string, string> = {}): CaptureBookFiles & { disk: Map<string, string>; writes: string[] } {
  const disk = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    disk,
    writes,
    read: async (file) => disk.get(file) ?? null,
    replace: async (file, text) => {
      writes.push(file);
      disk.set(file, text);
    },
  };
}

const bookOn = (files: CaptureBookFiles) => createLanCaptureBook({ directory: () => "/data", files });

describe("the LAN capture book", () => {
  it("keeps an approval's capture, a late one for a released charge too, as the leg's wire", async () => {
    const book = bookOn(memoryFiles());
    book.observe({ kind: "orphan-capture", deviceId: "device-2", chargeId: "charge-9", state: "approved", capture: { ...TRACE, transactionCode: "PAG-LATE" } });

    expect(await book.claim("PAG-LATE", "entry-a")).toEqual({ ok: true, wire: captureWireOf("device-2", { ...TRACE, transactionCode: "PAG-LATE" }) });
  });

  it("maps the protocol's names onto the record's, trimming the code", () => {
    expect(captureWireOf("device-1", { ...TRACE, transactionCode: "  PAG-0001 " })).toEqual({
      transactionCode: "PAG-0001",
      kind: "CREDIT",
      amountCents: 650,
      capturedAt: TRACE.capturedAt,
      transactionId: "tx-1",
      hostNsu: null,
      authorizationCode: "A1",
      cardBrand: "VISA",
      installments: 1,
      terminalSerial: "PAX-0001",
      entryMode: "CHIP",
      deviceId: "device-1",
    });
  });

  it("hears what the terminal wiring broadcasts, and still sends it on", async () => {
    const book = bookOn(memoryFiles());
    const sent: unknown[] = [];
    const broadcast = book.tap((channel: string, event) => sent.push([channel, event]));

    broadcast("terminal", approved());

    expect(sent).toEqual([["terminal", approved()]]);
    expect(await book.claim("PAG-0001", "entry-a")).toMatchObject({ ok: true, wire: { transactionCode: "PAG-0001", deviceId: "device-1" } });
  });

  it("keeps nothing for a status that captured nothing", async () => {
    const files = memoryFiles();
    const book = bookOn(files);
    book.observe({ kind: "status", deviceId: "device-1", chargeId: "charge-1", state: "cancelled" });
    book.observe({ kind: "orphan-capture", deviceId: "device-1", chargeId: "charge-1", state: "method_changed", method: "CASH" });
    book.observe({ kind: "state", state: { listening: [], terminals: [] } });
    await book.settled();

    expect(files.writes).toEqual([]);
    expect(await book.claim("PAG-0001", "entry-a")).toEqual({ ok: false, reason: "UNHEARD" });
    expect(files.writes).toEqual([]);
  });
});

describe("one capture, one sale", () => {
  it("refuses a second entry naming a capture another entry claimed, and lets the same entry claim it again", async () => {
    const book = bookOn(memoryFiles());
    book.observe(approved());

    expect(await book.claim("PAG-0001", "entry-a")).toMatchObject({ ok: true });
    expect(await book.claim("PAG-0001", "entry-b")).toEqual({ ok: false, reason: "TAKEN" });
    expect(await book.claim("PAG-0001", "entry-a")).toMatchObject({ ok: true, wire: { transactionCode: "PAG-0001" } });
  });

  it("refuses the second of two entries asked together with one capture", async () => {
    const book = bookOn(memoryFiles());
    book.observe(approved());

    const [one, two] = await Promise.all([book.claim("PAG-0001", "entry-a"), book.claim("PAG-0001", "entry-b")]);

    expect([one.ok, two.ok]).toEqual([true, false]);
  });

  it("lets a capture go when its entry was not journaled, so the next entry may take it, keeping what was heard", async () => {
    const book = bookOn(memoryFiles());
    book.observe(approved());
    await book.claim("PAG-0001", "entry-a");

    await book.release("entry-a");

    expect(await book.claim("PAG-0001", "entry-b")).toMatchObject({ ok: true, wire: { transactionCode: "PAG-0001" } });
  });

  it("never claims a code the terminal did not report, and holds nothing for it", async () => {
    const book = bookOn(memoryFiles());
    expect(await book.claim("PAG-0001", "entry-a")).toEqual({ ok: false, reason: "UNHEARD" });
    book.observe(approved());
    await book.settled();

    expect(await book.claim("PAG-0001", "entry-b")).toMatchObject({ ok: true, wire: { transactionCode: "PAG-0001" } });
  });
});

describe("the capture book across a restart", () => {
  it("still holds a capture heard before the station restarted, and a claim made before it", async () => {
    const files = memoryFiles();
    const book = bookOn(files);
    book.observe(approved());
    book.observe(approved({ ...TRACE, transactionCode: "PAG-0002" }));
    await book.settled();
    await book.claim("PAG-0002", "entry-a");

    const reopened = bookOn(files);

    expect(await reopened.claim("PAG-0001", "entry-b")).toMatchObject({ ok: true, wire: { transactionCode: "PAG-0001" } });
    expect(await reopened.claim("PAG-0002", "entry-b")).toEqual({ ok: false, reason: "TAKEN" });
    expect([...files.disk.keys()]).toEqual(["/data/terminal-captures.json"]);
  });

  it("forgets the oldest past its limit", async () => {
    const book = bookOn(memoryFiles());
    book.observe(approved());
    for (let index = 0; index < MAX_KEPT; index += 1) book.observe(approved({ ...TRACE, transactionCode: `PAG-N${index}` }));
    await book.settled();

    expect(await book.claim("PAG-0001", "entry-a")).toEqual({ ok: false, reason: "UNHEARD" });
    expect(await book.claim(`PAG-N${MAX_KEPT - 1}`, "entry-a")).toMatchObject({ ok: true, wire: { transactionCode: `PAG-N${MAX_KEPT - 1}` } });
  });

  it("reads a garbled file as empty", async () => {
    const book = bookOn(memoryFiles({ "/data/terminal-captures.json": "{not json" }));
    expect(await book.claim("PAG-0001", "entry-a")).toEqual({ ok: false, reason: "UNHEARD" });
  });

  it("logs a write that failed and keeps serving", async () => {
    const logged: string[] = [];
    const files: CaptureBookFiles = { read: async () => null, replace: () => Promise.reject(new Error("disk full")) };
    const book = createLanCaptureBook({ directory: () => "/data", files, log: (message) => logged.push(message) });
    book.observe(approved());
    await book.settled();

    expect(logged).toEqual(["terminal-link: a heard capture was not kept on disk: Error: disk full"]);
  });
});
