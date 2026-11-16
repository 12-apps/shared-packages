import { describe, expect, it, vi } from "vitest";

import { createAutostart, type LoginItemPort } from "../../autostart";
import { createAutostartToggle } from "../autostart-toggle";

function setup(managedBySystem: boolean) {
  const state = { on: false };
  const setLoginItemSettings = vi.fn((settings: { openAtLogin: boolean }) => {
    state.on = settings.openAtLogin;
  });
  const port: LoginItemPort = {
    getLoginItemSettings: () => ({ openAtLogin: state.on }),
    setLoginItemSettings,
  };
  const autostart = createAutostart({
    platform: "win32",
    id: "app.id",
    entry: { name: "Agent", exec: "/app/agent" },
    loginItem: port,
    managedBySystem,
  });
  const openExternal = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
  const refresh = vi.fn(() => Promise.resolve());
  const onToggled = vi.fn();
  const toggle = createAutostartToggle({ autostart, openExternal, refresh, onToggled, enabled: () => state.on });
  return { toggle, setLoginItemSettings, openExternal, refresh, onToggled };
}

describe("the tray's start-with-the-machine click", () => {
  it("opens the system's startup settings in Store mode, and does not touch the login item", async () => {
    const run = setup(true);

    await run.toggle();

    expect(run.openExternal).toHaveBeenCalledWith("ms-settings:startupapps");
    expect(run.setLoginItemSettings).not.toHaveBeenCalled();
    expect(run.refresh).toHaveBeenCalledTimes(1);
    expect(run.onToggled).not.toHaveBeenCalled();
  });

  it("survives a refused handler in Store mode", async () => {
    const run = setup(true);
    run.openExternal.mockRejectedValueOnce(new Error("no handler"));

    await expect(run.toggle()).resolves.toBeUndefined();
  });

  it("still flips the login item, reads it back and tells the host outside Store mode", async () => {
    const run = setup(false);

    await run.toggle();

    expect(run.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, openAsHidden: true, args: [] });
    expect(run.openExternal).not.toHaveBeenCalled();
    expect(run.refresh).toHaveBeenCalledTimes(1);
    expect(run.onToggled).toHaveBeenCalledTimes(1);
  });
});
