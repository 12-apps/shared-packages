import { Menu, shell, Tray } from "electron";

import type { Autostart } from "../autostart";
import type { ShellStatus } from "../status";

import { createAutostartToggle } from "./autostart-toggle";
import { buildTrayMenu, type TrayActions, type TrayCopy } from "./tray-menu";

/**
 * The tray icon, and the only piece of the shell a person actually looks at.
 *
 * It owns three things and nothing else: the `Tray`, the repaint, and the
 * autostart checkbox's read-back. What the menu CONTAINS is `./tray-menu`,
 * which is pure data and asserted without a display.
 */

interface TrayController {
  /** Repaint for a status. Safe to call before anything has changed. */
  render(status: ShellStatus): void;
  /**
   * Read autostart back and repaint: it changed somewhere else (the host's
   * first-time step, a settings checkbox), and the checkbox must say so.
   */
  refreshAutostart(): Promise<void>;
}

interface TrayControllerOptions {
  copy: TrayCopy;
  /** An icon file path per status. The host's artwork, in the host's brand. */
  icons: Record<ShellStatus, string>;
  autostart: Autostart;
  /** The current status, re-read on every repaint and on a tray click. */
  status: () => ShellStatus;
  /** Everything the menu can do, except the autostart toggle this owns. */
  actions: Omit<TrayActions, "toggleAutostart">;
  /** After the person flips the checkbox here: a choice the host may record. */
  onAutostartToggled?: () => void | Promise<void>;
}

export async function createTrayController(
  options: TrayControllerOptions,
): Promise<TrayController> {
  const tray = new Tray(options.icons.starting);
  const view = { autostartEnabled: await options.autostart.isEnabled() };

  const toggleAutostart = createAutostartToggle({
    autostart: options.autostart,
    openExternal: (url) => shell.openExternal(url),
    refresh: () => refreshAutostart(),
    enabled: () => view.autostartEnabled,
    ...(options.onAutostartToggled === undefined ? {} : { onToggled: options.onAutostartToggled }),
  });

  async function refreshAutostart(): Promise<void> {
    view.autostartEnabled = await options.autostart.isEnabled();
    render(options.status());
  }

  function render(status: ShellStatus): void {
    tray.setImage(options.icons[status]);
    tray.setToolTip(options.copy.status[status]);
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenu({
          status,
          copy: options.copy,
          autostartEnabled: view.autostartEnabled,
          autostartManagedBySystem: options.autostart.managedBySystem === true,
          actions: { ...options.actions, toggleAutostart: () => void toggleAutostart() },
        }),
      ),
    );
  }

  // A left click on the icon is the gesture everybody tries first; on Windows
  // and Linux it does nothing unless it is wired, and on macOS the menu opens
  // anyway.
  tray.on("click", () =>
    options.status() === "signed-out" ? options.actions.signIn() : options.actions.settings(),
  );
  render(options.status());
  return { render, refreshAutostart };
}
