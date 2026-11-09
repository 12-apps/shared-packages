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

describe("the manual check's answer", () => {
  /** A manager whose check lands on `after`, as the real one does once it has asked. */
  function checking(after: UpdateState): ReturnType<typeof manager> {
    const updates = manager({ kind: "idle" });
    updates.check = vi.fn(() => {
      updates.set(after);
      return Promise.resolve();
    });
    return updates;
  }

  /** A manager whose check cannot reach the feed: it rejects, as a network error does. */
  const offline = (): UpdateManager => ({ ...manager({ kind: "idle" }), check: vi.fn(() => Promise.reject(new Error("offline"))) });

  /** Help › Check for updates, clicked, until its message box is up. */
  async function ask(updates: UpdateManager): Promise<void> {
    installAppMenu({ copy: TEST_MENU_COPY, updates });
    entry("Help", "Check for updates")?.click?.();
    await vi.waitFor(() => expect(recorded.boxes).toHaveLength(1));
  }

  /** Everything the click left to do after the box was answered has run. */
  const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

  it("offers the restart when a version is on disk, as an info box with Restart first and Later as its escape", async () => {
    const updates = checking({ kind: "ready", version: "2.0.0" });

    await ask(updates);

    expect(recorded.boxes[0]).toMatchObject({
      title: "Agent",
      type: "info",
      message: "Version 2.0.0 is ready to install.",
      buttons: ["Restart and update", "Later"],
      defaultId: 0,
      cancelId: 1,
    });
  });

  it("installs when the person picks Restart and update", async () => {
    recorded.answer(0);
    const updates = checking({ kind: "ready", version: "2.0.0" });

    await ask(updates);

    await vi.waitFor(() => expect(updates.install).toHaveBeenCalledTimes(1));
  });

  it("installs nothing when the person picks Later, or closes the box (its cancel button)", async () => {
    recorded.answer(1);
    const updates = checking({ kind: "ready", version: "2.0.0" });

    await ask(updates);
    await settled();

    expect(updates.install).not.toHaveBeenCalled();
  });

  it("warns, with a single OK, when the check failed — and never installs on that OK", async () => {
    const updates = checking({ kind: "failed" });

    await ask(updates);
    await settled();

    expect(recorded.boxes[0]).toMatchObject({
      title: "Agent",
      type: "warning",
      message: "Could not check right now.",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
    });
    // Button 0 is OK here, not Restart: only a ready version may install on it.
    expect(updates.install).not.toHaveBeenCalled();
  });

  it("is an info box for every other answer, with a single OK", async () => {
    const updates = checking({ kind: "downloading", version: "2.0.0", percent: 40 });

    await ask(updates);

    expect(recorded.boxes[0]).toMatchObject({ type: "info", message: "Downloading 2.0.0 (40%)", buttons: ["OK"], cancelId: 0 });
  });

  it("parents the box to the window in front, when there is one", async () => {
    const front = { id: "settings window" };
    recorded.putInFront(front);

    await ask(checking({ kind: "none" }));

    expect(recorded.boxes[0]).toMatchObject({ parented: true, owner: front });
  });

  it("shows the box on its own when no window is in front, as with every window closed", async () => {
    await ask(checking({ kind: "none" }));

    expect(recorded.boxes[0]).toMatchObject({ parented: false, owner: null });
  });

  it("lets a check that rejects pass without a box, and without an unhandled rejection", async () => {
    const updates = offline();
    installAppMenu({ copy: TEST_MENU_COPY, updates });

    entry("Help", "Check for updates")?.click?.();
    await settled();

    expect(updates.check).toHaveBeenCalledWith({ manual: true });
    expect(recorded.boxes).toEqual([]);
  });
});
