import { afterEach, describe, expect, it, vi } from "vitest";

import type { UpdateManager, UpdateState } from "../../updates";
import { TEST_MENU_COPY } from "../../updates/__tests__/menu-copy";
import { installAppMenu } from "../app-menu";
import { current, entry, recorded } from "./fake-electron";

vi.mock("electron", async () => (await import("./fake-electron")).electronModule);

/**
 * The menu adapter, against a stand-in `electron`.
 *
 * The rule worth a test is the one that crashed a Windows agent: replacing the
 * application menu while one of its popups is OPEN. A state that arrives then
 * is held and drawn once the popup closes — and only then.
 */

function manager(state: UpdateState): UpdateManager & { set(next: UpdateState): void } {
  const held = { state };
  return {
    get state() {
      return held.state;
    },
    set(next) {
      held.state = next;
    },
    check: vi.fn(() => Promise.resolve()),
    install: vi.fn(),
    stop: vi.fn(),
  };
}

afterEach(() => {
  recorded.reset();
});

describe("installAppMenu", () => {
  it("puts a menu up at once, before the updater reports anything", () => {
    installAppMenu({ copy: TEST_MENU_COPY, updates: manager({ kind: "idle" }) });

    expect(recorded.menus).toHaveLength(1);
    expect(entry("Help", "Version 1.0.0")).toBeDefined();
  });

  it("does not rebuild for a new download percent", () => {
    const menu = installAppMenu({
      copy: TEST_MENU_COPY,
      updates: manager({ kind: "downloading", version: "2.0.0", percent: 10 }),
    });

    menu.render({ kind: "downloading", version: "2.0.0", percent: 60 });

    expect(recorded.menus).toHaveLength(1);
  });

  it("never replaces the menu while a popup is open, and draws the newest state once it closes", async () => {
    const menu = installAppMenu({ copy: TEST_MENU_COPY, updates: manager({ kind: "idle" }) });
    const help = current().items.at(-1)?.submenu;

    help?.emit("menu-will-show");
    menu.render({ kind: "checking" });
    menu.render({ kind: "ready", version: "2.0.0" });

    expect(recorded.menus).toHaveLength(1);

    help?.emit("menu-will-close");

    await vi.waitFor(() => expect(recorded.menus).toHaveLength(2));
    expect(entry("Help", "Restart and update")).toBeDefined();
  });

  it("reports the popup opening and closing", () => {
    const seen: boolean[] = [];
    installAppMenu({
      copy: TEST_MENU_COPY,
      updates: manager({ kind: "idle" }),
      onMenu: (open) => seen.push(open),
    });

    current().emit("menu-will-show");
    current().emit("menu-will-close");

    expect(seen).toEqual([true, false]);
  });

  it("answers the manual check in a box titled with the host's name", async () => {
    const updates = manager({ kind: "idle" });
    updates.check = vi.fn(() => {
      updates.set({ kind: "none" });
      return Promise.resolve();
    });
    installAppMenu({ copy: TEST_MENU_COPY, updates });

    entry("Help", "Check for updates")?.click?.();

    await vi.waitFor(() => expect(recorded.boxes).toHaveLength(1));
    expect(updates.check).toHaveBeenCalledWith({ manual: true });
    expect(recorded.boxes[0]).toMatchObject({
      title: "Agent",
      message: "You are on the newest version.",
      buttons: ["OK"],
    });
    expect(updates.install).not.toHaveBeenCalled();
  });

  it("places the host's own entries first in File", () => {
    installAppMenu({
      copy: TEST_MENU_COPY,
      updates: manager({ kind: "idle" }),
      extraMenuItems: [{ label: "Settings" }],
    });

    const file = current().template[0]?.submenu ?? [];
    expect(file.map((item) => item.type ?? item.label)).toEqual(["Settings", "separator", "Quit"]);
  });
});
