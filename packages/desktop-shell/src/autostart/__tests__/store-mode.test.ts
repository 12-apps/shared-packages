import { describe, expect, it, vi } from "vitest";

import { createAutostart, createFirstRunAutostart, observeAutostart, type LoginItemPort } from "../index";

function loginItem(): LoginItemPort & { set: ReturnType<typeof vi.fn> } {
  const set = vi.fn();
  return { getLoginItemSettings: () => ({ openAtLogin: true }), setLoginItemSettings: set, set };
}

const ENTRY = { name: "Agent", exec: "/app/agent" };

function managed(port = loginItem()): { autostart: ReturnType<typeof createAutostart>; port: ReturnType<typeof loginItem> } {
  return {
    port,
    autostart: createAutostart({ platform: "win32", id: "app.id", entry: ENTRY, loginItem: port, managedBySystem: true }),
  };
}

describe("autostart owned by the system (a Store install)", () => {
  it("reports itself as managed, answers off and never writes the login item", async () => {
    const { autostart, port } = managed();

    await autostart.set(true);
    await autostart.enable();
    await autostart.disable();

    expect(autostart.managedBySystem).toBe(true);
    expect(await autostart.isEnabled()).toBe(false);
    expect(port.set).not.toHaveBeenCalled();
  });

  it("keeps the flag through the observing wrapper", () => {
    expect(observeAutostart(managed().autostart, () => undefined).managedBySystem).toBe(true);
  });

  it("never asks the first-time question, and never calls set when answered anyway", async () => {
    const { autostart, port } = managed();
    const set = vi.spyOn(autostart, "set");
    const remember = vi.fn(() => Promise.resolve());
    const ask = createFirstRunAutostart({ autostart, platform: "win32", defaultOn: true, chosen: () => false, remember });

    expect(ask.shouldAsk()).toBe(false);
    await ask.answer(true);

    expect(set).not.toHaveBeenCalled();
    expect(port.set).not.toHaveBeenCalled();
  });
});

describe("autostart outside Store mode is unchanged", () => {
  it("writes the login item and asks the first-time question on Windows", async () => {
    const port = loginItem();
    const autostart = createAutostart({ platform: "win32", id: "app.id", entry: ENTRY, loginItem: port });
    const ask = createFirstRunAutostart({ autostart, platform: "win32", defaultOn: true, chosen: () => false, remember: () => Promise.resolve() });

    expect(autostart.managedBySystem).toBeUndefined();
    expect(ask.shouldAsk()).toBe(true);
    await ask.answer(true);
    expect(port.set).toHaveBeenCalledWith({ openAtLogin: true, openAsHidden: true, args: [] });
  });
});
