import { describe, expect, it } from "vitest";

import { createHeldCaptures, preselectRecovered, unclaimedCount, type HeldCapture } from "../index";

/**
 * FUT-4996 (D7) contract: money the terminal already took, kept per sale key
 * (R12, K3) and recovered on load (R19, State 3), in
 * `@12-apps/payments-frontend/terminal-charge`. Host-agnostic: a "key" is the
 * host's own sale key.
 */

const held = (code: string, amountCents: number, kind: HeldCapture["kind"] = "CREDIT"): HeldCapture => ({
  transactionCode: code,
  kind,
  amountCents,
  capturedAt: "2026-11-14T17:31:00.000Z",
  deviceId: "dev-1",
});

describe("R12: held captures belong to their key until something accounts for them", () => {
  it("R12: a capture held under a key survives clearing the sale; only a bind, a flag or an explicit release removes it", () => {
    const store = createHeldCaptures();
    store.hold("key-1", held("PAG-0001", 3200));

    store.saleCleared("key-1");
    expect(store.heldFor("key-1").map((c) => c.transactionCode)).toEqual(["PAG-0001"]);

    store.release("key-1", "PAG-0001", "bound");
    expect(store.heldFor("key-1")).toEqual([]);
  });

  it("R12: `release` needs a reason that accounts for the money; anything else is refused", () => {
    const store = createHeldCaptures();
    store.hold("key-1", held("PAG-0001", 3200));

    expect(() => store.release("key-1", "PAG-0001", "cleared" as never)).toThrow();
    expect(store.heldFor("key-1")).toHaveLength(1);
  });

  it("R12: one capture is held under one key only", () => {
    const store = createHeldCaptures();
    store.hold("key-1", held("PAG-0001", 3200));

    expect(() => store.hold("key-2", held("PAG-0001", 3200))).toThrow(/PAG-0001/);
  });
});

describe("R19: State 3 — recovered on load, the one that fits already ticked", () => {
  const listed = [held("PAG-0010", 4600), held("PAG-0011", 1850, "PIX"), held("PAG-0012", 9000)];

  it("R19: ticks the capture whose amount equals what is still due", () => {
    expect(preselectRecovered(listed, 4600, new Set())).toEqual(["PAG-0010"]);
  });

  it("R19: with no exact fit, ticks the largest that is not above what is due; with none, ticks nothing", () => {
    expect(preselectRecovered(listed, 7800, new Set())).toEqual(["PAG-0010"]);
    expect(preselectRecovered(listed, 1000, new Set())).toEqual([]);
  });

  it("R19: never ticks — nor counts on the chip — a code the station holds as a typed capture (FUT-4997's band)", () => {
    const typed = new Set(["PAG-0010"]);

    expect(preselectRecovered(listed, 4600, typed)).toEqual([]);
    expect(unclaimedCount(listed, typed)).toBe(2);
  });
});
