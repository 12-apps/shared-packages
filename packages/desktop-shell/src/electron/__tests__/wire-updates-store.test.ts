import { afterEach, describe, expect, it, vi } from "vitest";

import type { UpdateManager } from "../../updates";
import { TEST_MENU_COPY } from "../../updates/__tests__/menu-copy";
import { wireUpdates } from "../wire-updates";
import { current, entry, recorded } from "./fake-electron";

vi.mock("electron", async () => (await import("./fake-electron")).electronModule);

afterEach(() => recorded.reset());

function wire(windowsStore: boolean) {
  const create = vi.fn((): UpdateManager => ({
    state: { kind: "none" },
    check: vi.fn(() => Promise.resolve()),
    install: vi.fn(),
    stop: vi.fn(),
  }));
  const crumbs: string[] = [];
  const shown: (() => void)[] = [];
  const updates = wireUpdates({
    create,
    telemetry: {
      breadcrumb: (text) => void crumbs.push(text),
      installing: () => Promise.resolve(),
      failedInstall: () => null,
    },
    busy: () => false,
    autoUpdate: () => true,
    menuCopy: TEST_MENU_COPY,
    onWindowShown: (listener) => void shown.push(listener),
    windowsStore,
  });
  return { create, updates, crumbs, shown };
}

const helpLabels = (): (string | undefined)[] =>
  current().template.find((item) => item.label === "Help")?.submenu?.map((item) => item.label) ?? [];

describe("wireUpdates in Store mode", () => {
  it("builds no manager, so nothing checks, downloads or runs a timer", async () => {
    const wired = wire(true);

    await wired.updates.check({ manual: true });
    wired.updates.install();
    wired.updates.stop();

    expect(wired.create).not.toHaveBeenCalled();
    expect(wired.shown).toEqual([]);
    expect(wired.updates.state).toEqual({ kind: "unsupported" });
  });

  it("keeps the menu bar but offers no check, no install and no updater line", () => {
    wire(true);

    expect(entry("Help", "Check for updates")).toBeUndefined();
    expect(helpLabels()).toEqual(["Version 1.0.0"]);
  });
});

describe("wireUpdates outside Store mode", () => {
  it("builds the manager, listens for the window and offers the manual check", () => {
    const wired = wire(false);

    expect(wired.create).toHaveBeenCalledTimes(1);
    expect(wired.shown).toHaveLength(1);
    expect(entry("Help", "Check for updates")).toBeDefined();
  });
});
