import { afterEach, describe, expect, it, vi } from "vitest";

import type { Autostart } from "../../autostart";
import type { TrayMenuItem } from "../tray-menu";

const built: TrayMenuItem[][] = [];

vi.mock("electron", () => ({
  Tray: class {
    setImage(): void {}
    setToolTip(): void {}
    setContextMenu(): void {}
    on(): void {}
  },
  Menu: { buildFromTemplate: (template: TrayMenuItem[]) => void built.push(template) },
  shell: { openExternal: () => Promise.resolve() },
}));

const { createTrayController } = await import("../tray-controller");

afterEach(() => {
  built.length = 0;
});

const copy = {
  status: {
    starting: "s",
    "signed-out": "out",
    faulted: "f",
    connecting: "c",
    online: "on",
    degraded: "d",
    stopped: "x",
  },
  signIn: "in",
  signOut: "out",
  settings: "set",
  startAtLogin: "at-login",
  quit: "quit",
};

async function menuFor(autostart: Autostart): Promise<TrayMenuItem | undefined> {
  const icons = Object.fromEntries(Object.keys(copy.status).map((key) => [key, `${key}.png`]));
  await createTrayController({
    copy,
    icons: icons as never,
    autostart,
    status: () => "online",
    actions: { signIn: vi.fn(), signOut: vi.fn(), settings: vi.fn(), quit: vi.fn() },
  });
  return built.at(-1)?.find((item) => item.label === "at-login");
}

const base = {
  isEnabled: () => Promise.resolve(false),
  enable: () => Promise.resolve(),
  disable: () => Promise.resolve(),
  set: () => Promise.resolve(),
};

describe("the tray controller's autostart entry", () => {
  it("is a plain item, not a checkbox, when the system owns autostart", async () => {
    const item = await menuFor({ ...base, managedBySystem: true });
    expect(item).toBeDefined();
    expect(item).not.toHaveProperty("type");
    expect(item).not.toHaveProperty("checked");
  });

  it("is the checkbox otherwise", async () => {
    expect(await menuFor(base)).toMatchObject({ type: "checkbox", checked: false });
  });
});
