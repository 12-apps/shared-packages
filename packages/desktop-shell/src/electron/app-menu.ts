import { app, BrowserWindow, dialog, Menu } from "electron";

import {
  buildAppMenu,
  createMenuGate,
  sameMenu,
  updateText,
  type AppMenuItem,
  type MenuCopy,
  type UpdateManager,
  type UpdateState,
} from "../updates";

/**
 * The Electron half of the menu bar: building it, rebuilding it when the
 * updater moves, and answering Help › Check for updates.
 *
 * Every decision is `buildAppMenu`'s in `../updates`, which is tested without
 * Electron; so is the redraw gate.
 */

export interface AppMenu {
  /** Rebuild from the updater's latest state — wire to its `onState`. */
  render(state: UpdateState): void;
}

export interface AppMenuOptions {
  copy: MenuCopy;
  updates: UpdateManager;
  /** The host's own File entries, placed before Quit. */
  extraMenuItems?: readonly AppMenuItem[];
  /** The menu opening and closing — a breadcrumb for the crash reports. */
  onMenu?: (open: boolean) => void;
}

export function installAppMenu(options: AppMenuOptions): AppMenu {
  let drawn: UpdateState | null = null;
  // Never replace the menu under an open popup — see `createMenuGate`.
  const gate = createMenuGate<UpdateState>();
  const draw = (state: UpdateState): void => {
    const built = Menu.buildFromTemplate(
      buildAppMenu({
        copy: options.copy,
        version: app.getVersion(),
        updates: state,
        platform: process.platform,
        ...(options.extraMenuItems === undefined ? {} : { extraMenuItems: options.extraMenuItems }),
        actions: {
          // Caught: a rejected check in a tray process is an unhandled
          // rejection that takes the agent's work with it.
          checkUpdates: () => void checkAndAnswer(options).catch(() => undefined),
          installUpdate: () => options.updates.install(),
          // The shell's `before-quit` stops intercepting `close`, so this is
          // the same exit as the tray's Quit.
          quit: () => app.quit(),
        },
      }),
    );
    // Every submenu, not just the bar: on Windows the popup that is open is
    // Help's own menu, and that is the one that emits.
    for (const watched of [
      built,
      ...built.items.flatMap((item) => (item.submenu ? [item.submenu] : [])),
    ]) {
      watched.on("menu-will-show", () => {
        gate.opened();
        options.onMenu?.(true);
      });
      watched.on("menu-will-close", () => {
        options.onMenu?.(false);
        // After the popup is gone, not inside its own close handler.
        const next = gate.closed();
        if (next !== null) setImmediate(() => draw(next));
      });
    }
    Menu.setApplicationMenu(built);
  };
  const menu: AppMenu = {
    render: (state) => {
      // Only when what the menu SAYS changes — never per download percent
      // (see `menuUpdateState`).
      if (sameMenu(drawn, state)) return;
      drawn = state;
      const now = gate.offer(state);
      if (now !== null) draw(now);
    },
  };
  // Before any window opens: a window created first gets Electron's default
  // menu for as long as it takes the updater to report a state.
  menu.render(options.updates.state);
  return menu;
}

/**
 * The manual check, and its answer in a message box.
 *
 * A menu item has nowhere to put a result, so the answer is a box, over
 * whichever window is in front. A version already on disk offers the restart
 * there and then: that is the question somebody who asked "is there a new
 * one?" is about to ask next.
 */
async function checkAndAnswer(options: AppMenuOptions): Promise<void> {
  const { updates, copy } = options;
  await updates.check({ manual: true });
  const state = updates.state;
  const ready = state.kind === "ready";
  const box = {
    // The program's own name, not the executable's — and the host's word.
    title: copy.title,
    type: state.kind === "failed" ? ("warning" as const) : ("info" as const),
    message: updateText(copy.updates, state),
    buttons: ready ? [copy.installUpdate, copy.later] : [copy.ok],
    defaultId: 0,
    cancelId: ready ? 1 : 0,
  };
  const owner = BrowserWindow.getFocusedWindow();
  const { response } = await (owner === null
    ? dialog.showMessageBox(box)
    : dialog.showMessageBox(owner, box));
  if (ready && response === 0) updates.install();
}
