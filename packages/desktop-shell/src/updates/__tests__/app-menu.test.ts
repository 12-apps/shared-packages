import { describe, expect, it } from "vitest";

import { buildAppMenu, updateText, type AppMenuItem } from "../app-menu";
import type { UpdateState } from "../manager";
import { TEST_MENU_COPY as COPY } from "./menu-copy";

/**
 * The menu bar.
 *
 * It replaces Electron's default — English, with an empty Help — and carries
 * the version, what the updater is doing, and the two things a person can do
 * about it. The words below are a test pack: every one of them is the host's.
 */


const noop = (): void => undefined;

function menu(
  updates: UpdateState,
  platform: NodeJS.Platform = "win32",
  extraMenuItems: AppMenuItem[] = [],
): AppMenuItem[] {
  return buildAppMenu({
    copy: COPY,
    version: "0.1.49",
    updates,
    platform,
    extraMenuItems,
    actions: { checkUpdates: noop, installUpdate: noop, quit: noop },
  });
}

function help(updates: UpdateState): AppMenuItem[] {
  return menu(updates).at(-1)?.submenu ?? [];
}

function labels(items: AppMenuItem[]): (string | undefined)[] {
  return items.filter((item) => item.type !== "separator").map((item) => item.label);
}

describe("the menu bar", () => {
  it("is File and Help on Windows and Linux — no Edit, View or Window", () => {
    expect(labels(menu({ kind: "idle" }))).toEqual(["File", "Help"]);
    expect(labels(menu({ kind: "idle" }, "linux"))).toEqual(["File", "Help"]);
  });

  it("keeps Edit on macOS, where the menu is what makes copy and paste work", () => {
    const bar = menu({ kind: "idle" }, "darwin");

    expect(labels(bar)).toEqual(["File", "Edit", "Help"]);
    const edit = bar[1]?.submenu ?? [];
    expect(edit.map((item) => item.role).filter(Boolean)).toEqual([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
    expect(edit.find((item) => item.role === "paste")?.label).toBe("Paste");
  });

  it("puts the host's items first in File, then a separator, then Quit", () => {
    const seen: string[] = [];
    const file =
      buildAppMenu({
        copy: COPY,
        version: "0.1.49",
        updates: { kind: "idle" },
        platform: "win32",
        extraMenuItems: [{ label: "Settings", click: () => seen.push("settings") }],
        actions: { checkUpdates: noop, installUpdate: noop, quit: () => seen.push("quit") },
      })[0]?.submenu ?? [];

    expect(file.map((item) => item.type ?? item.label)).toEqual(["Settings", "separator", "Quit"]);
    for (const item of file) item.click?.();
    expect(seen).toEqual(["settings", "quit"]);
  });

  it("is only Quit in File when the host adds nothing — no dangling separator", () => {
    expect(menu({ kind: "idle" })[0]?.submenu).toEqual([{ label: "Quit", click: noop }]);
  });
});

describe("Help", () => {
  it("is never empty: it offers the check and says the version", () => {
    expect(labels(help({ kind: "idle" }))).toEqual(["Check for updates", "Version 0.1.49"]);
  });

  it("says the download while it runs — without its percent, which the window shows", () => {
    // A percent here meant rebuilding the menu bar several times a second,
    // under an open Help popup.
    const items = help({ kind: "downloading", version: "0.1.56", percent: 40.4 });

    expect(labels(items)).toEqual(["Check for updates", "Version 0.1.49", "Downloading 0.1.56…"]);
    // Read, not clicked.
    expect(items.at(-1)?.enabled).toBe(false);
  });

  it("offers the restart only once a version is on disk", () => {
    expect(labels(help({ kind: "downloading", version: "0.1.56", percent: null }))).not.toContain(
      "Restart and update",
    );
    expect(labels(help({ kind: "ready", version: "0.1.56" }))).toEqual([
      "Check for updates",
      "Restart and update",
      "Version 0.1.49",
      "Version 0.1.56 is ready to install.",
    ]);
  });

  it("hides the check where nothing found could be installed", () => {
    expect(labels(help({ kind: "unsupported" }))).toEqual([
      "Version 0.1.49",
      "Updates are manual on this system.",
    ]);
  });

  it("says each answer a check can end in", () => {
    expect(labels(help({ kind: "none" })).at(-1)).toBe("You are on the newest version.");
    expect(labels(help({ kind: "failed" })).at(-1)).toBe("Could not check right now.");
    expect(labels(help({ kind: "off" })).at(-1)).toBe("Automatic updates are off.");
    expect(labels(help({ kind: "checking" })).at(-1)).toBe("Looking for a new version…");
  });
});

describe("updateText", () => {
  it("has a sentence for the signed-out answer the menu itself leaves out", () => {
    // The manual check's message box needs it; the menu line does not repeat
    // what the tray already says.
    expect(updateText(COPY.updates, { kind: "idle" })).toBe("Sign in to check.");
  });

  it("leaves the percent out until the first byte moves", () => {
    expect(
      updateText(COPY.updates, { kind: "downloading", version: "0.1.56", percent: null }),
    ).toBe("Downloading 0.1.56…");
  });
});
