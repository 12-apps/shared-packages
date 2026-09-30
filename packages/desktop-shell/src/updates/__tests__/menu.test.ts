import { describe, expect, it } from "vitest";

import { createMenuGate, menuUpdateState, sameMenu } from "../menu";

describe("the menu during a download", () => {
  it("draws the same menu for every percent of one download", () => {
    const at40 = { kind: "downloading", version: "0.1.67", percent: 40 } as const;
    const at41 = { kind: "downloading", version: "0.1.67", percent: 41 } as const;

    expect(sameMenu(at40, at41)).toBe(true);
    expect(menuUpdateState(at41)).toEqual({ kind: "downloading", version: "0.1.67", percent: null });
  });

  it("draws a new one when what it says changes", () => {
    expect(sameMenu(null, { kind: "idle" })).toBe(false);
    expect(
      sameMenu(
        { kind: "downloading", version: "0.1.67", percent: 99 },
        { kind: "ready", version: "0.1.67" },
      ),
    ).toBe(false);
  });
});

describe("never replacing the menu under an open popup", () => {
  it("draws at once while the menu is closed", () => {
    const gate = createMenuGate<string>();

    expect(gate.offer("ready")).toBe("ready");
  });

  it("holds what arrives while the menu is open, and draws only the newest on close", () => {
    // The crash this exists for: the second time a menu was opened during a download.
    const gate = createMenuGate<string>();
    gate.opened();

    expect(gate.offer("downloading")).toBeNull();
    expect(gate.offer("ready")).toBeNull();
    expect(gate.closed()).toBe("ready");
    expect(gate.closed()).toBeNull();
  });

  it("waits for the last open popup to close (a submenu inside the bar)", () => {
    const gate = createMenuGate<string>();
    gate.opened();
    gate.opened();
    gate.offer("ready");

    expect(gate.closed()).toBeNull();
    expect(gate.closed()).toBe("ready");
  });
});
