import { describe, expect, it, vi } from "vitest";

import { startedInBackground } from "../background";
import { buildTrayMenu, type TrayActions, type TrayCopy } from "../tray-menu";

const copy: TrayCopy = {
  status: {
    starting: "s",
    "signed-out": "out",
    faulted: "fault",
    connecting: "conn",
    online: "on",
    degraded: "deg",
    stopped: "stop",
  },
  signIn: "sign-in",
  signOut: "sign-out",
  settings: "settings",
  startAtLogin: "at-login",
  quit: "quit",
};

const actions: TrayActions = {
  signIn: vi.fn(),
  signOut: vi.fn(),
  settings: vi.fn(),
  toggleAutostart: vi.fn(),
  quit: vi.fn(),
};

const labels = (items: { label?: string }[]): string[] =>
  items.map((item) => item.label).filter((label): label is string => label !== undefined);

describe("buildTrayMenu", () => {
  it("leads with the status as a DISABLED label, never a clickable lie", () => {
    const [first] = buildTrayMenu({ status: "online", copy, autostartEnabled: false, actions });
    expect(first).toEqual({ label: "on", enabled: false });
  });

  it("offers only a sign-in while signed out", () => {
    const menu = buildTrayMenu({ status: "signed-out", copy, autostartEnabled: false, actions });
    expect(labels(menu)).toEqual(["out", "sign-in", "at-login", "quit"]);
  });

  it("offers settings and sign-out once there is a session", () => {
    const menu = buildTrayMenu({ status: "degraded", copy, autostartEnabled: true, actions });
    expect(labels(menu)).toEqual(["deg", "settings", "sign-out", "at-login", "quit"]);
  });

  it("reflects the autostart state in the checkbox", () => {
    const menu = buildTrayMenu({ status: "online", copy, autostartEnabled: true, actions });
    expect(menu.find((item) => item.label === "at-login")).toMatchObject({
      type: "checkbox",
      checked: true,
    });
  });

  it("hides the entry where the platform has no autostart port", () => {
    const menu = buildTrayMenu({
      status: "online",
      copy,
      autostartEnabled: false,
      autostartSupported: false,
      actions,
    });
    expect(labels(menu)).not.toContain("at-login");
    expect(labels(menu)).toContain("quit");
  });
});

describe("startedInBackground", () => {
  it("reads the flag the autostart entry was registered with", () => {
    expect(startedInBackground(["/opt/agent", "--background"])).toBe(true);
    expect(startedInBackground(["/opt/agent"])).toBe(false);
  });

  it("trusts macOS's own answer, which survives a login item made by hand", () => {
    expect(startedInBackground(["/opt/agent"], { wasOpenedAtLogin: true })).toBe(true);
  });
});
