import type { ShellStatus } from "../status";

/**
 * The tray menu, as data.
 *
 * Electron's `Menu.buildFromTemplate` takes a plain array, so the DECISIONS —
 * which entries exist, which are disabled, what the checkbox reads — are
 * ordinary values that a test can assert without a display, an app instance or
 * a window. That split is the reason this file exists separately from the
 * adapter: the adapter's remaining job is `Menu.buildFromTemplate(template)`,
 * which has nothing left to get wrong.
 */

/** Structurally Electron's `MenuItemConstructorOptions`, narrowed to what is used. */
export interface TrayMenuItem {
  label?: string;
  type?: "normal" | "separator" | "checkbox";
  enabled?: boolean;
  checked?: boolean;
  click?: () => void;
}

/**
 * The words. Required, never defaulted — see the package docblock.
 *
 * `status` is a record over every {@link ShellStatus} rather than a function,
 * so a host that adds a state to its own switch cannot forget this one: the
 * type stops compiling.
 */
export interface TrayCopy {
  status: Record<ShellStatus, string>;
  signIn: string;
  signOut: string;
  settings: string;
  startAtLogin: string;
  quit: string;
}

export interface TrayActions {
  signIn: () => void;
  signOut: () => void;
  settings: () => void;
  toggleAutostart: () => void;
  quit: () => void;
}

export interface TrayMenuInput {
  status: ShellStatus;
  copy: TrayCopy;
  autostartEnabled: boolean;
  /** Hidden entirely where the platform has no autostart port. */
  autostartSupported?: boolean;
  actions: TrayActions;
}

/**
 * Build the menu for one moment.
 *
 * Two shapes, decided by whether there is a session:
 *
 *  - **Signed out** — the only thing worth offering is signing in. Settings
 *    that cannot be saved and a sign-out that ends nothing are entries that
 *    waste a click and teach somebody the menu lies.
 *  - **Signed in** — everything, with the status line at the top as a disabled
 *    entry. Disabled because it is a LABEL: a clickable line that does nothing
 *    is the commonest small lie a tray menu tells.
 */
export function buildTrayMenu(input: TrayMenuInput): TrayMenuItem[] {
  const { copy, actions, status } = input;
  const items: TrayMenuItem[] = [
    { label: copy.status[status], enabled: false },
    { type: "separator" },
  ];

  if (status === "signed-out") {
    items.push({ label: copy.signIn, click: actions.signIn });
  } else {
    items.push({ label: copy.settings, click: actions.settings });
    items.push({ label: copy.signOut, click: actions.signOut });
  }

  if (input.autostartSupported !== false) {
    items.push({ type: "separator" });
    items.push({
      label: copy.startAtLogin,
      type: "checkbox",
      checked: input.autostartEnabled,
      click: actions.toggleAutostart,
    });
  }

  items.push({ type: "separator" });
  items.push({ label: copy.quit, click: actions.quit });
  return items;
}
