import type { UpdateState } from "./manager";
import { menuUpdateState } from "./menu";

/**
 * The menu bar of an agent's windows, with the updater under Help.
 *
 * Nobody used to install one, so Electron put up its own — `File Edit View
 * Window Help`, in English, with a Help that opened on "(empty)" — and the
 * version and "check now" had to live somewhere in the window. The update
 * controls belong where a person looks for "which version is this?": under
 * Help.
 *
 * Pure, like `buildTrayMenu` in `./electron`: the decisions are made here and
 * tested without Electron, and the adapter's only job is
 * `Menu.buildFromTemplate` (`installAppMenu` in `./electron`).
 *
 * Every word is the host's ({@link MenuCopy}). What the File menu offers
 * besides quitting is the host's too ({@link AppMenuInput.extraMenuItems}):
 * the package owns the menu's shape and the updater's entries, never what the
 * agent's own windows are.
 */

/** Structurally Electron's `MenuItemConstructorOptions`, narrowed to what is used. */
export interface AppMenuItem {
  label?: string;
  type?: "normal" | "separator" | "submenu";
  role?: "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll";
  enabled?: boolean;
  click?: () => void;
  submenu?: AppMenuItem[];
}

/** One sentence per update state, for the menu line and the manual check's answer. */
export interface UpdateCopy {
  /** Signed out or no feed yet: there is nothing to ask. */
  idle: string;
  off: string;
  unsupported: string;
  checking: string;
  none: string;
  failed: string;
  downloading: (version: string, percent: number | null) => string;
  ready: (version: string) => string;
}

/** Every word the menu bar and the manual check's message box say. */
export interface MenuCopy {
  /** The title of the manual check's message box: the program's own name. */
  title: string;
  file: string;
  quit: string;
  edit: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  help: string;
  checkUpdates: string;
  installUpdate: string;
  /** The version line — the first thing a support call asks for. */
  version: (version: string) => string;
  /** The OK button of the manual check's answer. */
  ok: string;
  /** The "not now" button when a version is ready to install. */
  later: string;
  updates: UpdateCopy;
}

/** What the menu's own entries do. */
export interface AppMenuActions {
  checkUpdates: () => void;
  installUpdate: () => void;
  quit: () => void;
}

export interface AppMenuInput {
  copy: MenuCopy;
  version: string;
  updates: UpdateState;
  actions: AppMenuActions;
  platform: NodeJS.Platform;
  /**
   * The host's own File entries (its settings window, say), placed FIRST,
   * before a separator and Quit.
   */
  extraMenuItems?: readonly AppMenuItem[];
}

/** What the update state says, in one sentence. */
export function updateText(copy: UpdateCopy, state: UpdateState): string {
  switch (state.kind) {
    case "downloading":
      return copy.downloading(state.version, state.percent);
    case "ready":
      return copy.ready(state.version);
    default:
      return copy[state.kind];
  }
}

/**
 * The whole menu bar.
 *
 * Edit exists on macOS only: there the clipboard roles are what make copy and
 * paste work in a form at all, while on Windows and Linux the shortcuts work
 * with no menu. View and Window go nowhere: reload, devtools and zoom are
 * ways for the person at the machine to break the window.
 */
export function buildAppMenu(input: AppMenuInput): AppMenuItem[] {
  const { copy, actions } = input;
  const edit: AppMenuItem[] = input.platform === "darwin" ? [editMenu(copy)] : [];
  const extra = input.extraMenuItems ?? [];
  const file: AppMenuItem[] = [
    ...extra,
    ...(extra.length > 0 ? [{ type: "separator" as const }] : []),
    { label: copy.quit, click: actions.quit },
  ];
  return [
    { label: copy.file, submenu: file },
    ...edit,
    { label: copy.help, submenu: helpMenu(input) },
  ];
}

/** The clipboard roles, for the one platform that needs a menu to have them. */
function editMenu(copy: MenuCopy): AppMenuItem {
  return {
    label: copy.edit,
    submenu: [
      { label: copy.undo, role: "undo" },
      { label: copy.redo, role: "redo" },
      { type: "separator" },
      { label: copy.cut, role: "cut" },
      { label: copy.copy, role: "copy" },
      { label: copy.paste, role: "paste" },
      { label: copy.selectAll, role: "selectAll" },
    ],
  };
}

/**
 * Help: the version, what the updater is doing, and the two things to do
 * about it.
 *
 * The status lines are disabled items — read, not clicked. Nothing to check on
 * a system that cannot install what it finds, and nothing to restart into
 * until a version is actually on disk.
 */
function helpMenu(input: AppMenuInput): AppMenuItem[] {
  const { copy, updates, actions } = input;
  const items: AppMenuItem[] = [];
  if (updates.kind !== "unsupported") {
    items.push({ label: copy.checkUpdates, click: actions.checkUpdates });
  }
  if (updates.kind === "ready") {
    items.push({ label: copy.installUpdate, click: actions.installUpdate });
  }
  items.push({ type: "separator" }, { label: copy.version(input.version), enabled: false });
  // `idle` is the manual check's answer ("sign in first"), not news: a tray
  // already says the agent is signed out, and a second line about it here
  // would be the same sentence twice.
  if (updates.kind !== "idle") {
    items.push({ label: updateText(copy.updates, menuUpdateState(updates)), enabled: false });
  }
  return items;
}
