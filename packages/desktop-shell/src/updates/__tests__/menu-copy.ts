import type { MenuCopy } from "../app-menu";

/** A test pack: every word of a real menu is the host's. */
export const TEST_MENU_COPY: MenuCopy = {
  title: "Agent",
  file: "File",
  quit: "Quit",
  edit: "Edit",
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select all",
  help: "Help",
  checkUpdates: "Check for updates",
  installUpdate: "Restart and update",
  version: (version) => `Version ${version}`,
  ok: "OK",
  later: "Later",
  updates: {
    idle: "Sign in to check.",
    off: "Automatic updates are off.",
    unsupported: "Updates are manual on this system.",
    checking: "Looking for a new version…",
    none: "You are on the newest version.",
    failed: "Could not check right now.",
    downloading: (version, percent) =>
      percent === null ? `Downloading ${version}…` : `Downloading ${version} (${Math.round(percent)}%)`,
    ready: (version) => `Version ${version} is ready to install.`,
  },
};
