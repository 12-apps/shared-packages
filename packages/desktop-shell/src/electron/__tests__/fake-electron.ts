import type { AppMenuItem } from "../../updates";

/**
 * A stand-in for the slice of `electron` the menu adapter touches.
 *
 * `electron` cannot be imported outside an Electron runtime, so the adapter's
 * tests replace the module with this (`vi.mock("electron", …)`) and read what
 * it recorded: every menu set, every message box shown.
 */

interface FakeMenu {
  template: AppMenuItem[];
  items: { submenu: FakeMenu | null }[];
  on(event: string, listener: () => void): void;
  emit(event: string): void;
}

function makeMenu(template: AppMenuItem[]): FakeMenu {
  const listeners = new Map<string, (() => void)[]>();
  return {
    template,
    items: template.map((item) => ({ submenu: item.submenu ? makeMenu(item.submenu) : null })),
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    emit(event) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

interface MessageBox {
  title: string;
  message: string;
  buttons: string[];
}

export const recorded = {
  /** Every menu handed to `setApplicationMenu`, oldest first. */
  menus: [] as FakeMenu[],
  boxes: [] as MessageBox[],
  /** The button the next message box answers with. */
  response: 0,
  reset(): void {
    this.menus.length = 0;
    this.boxes.length = 0;
    this.response = 0;
  },
};

export const electronModule = {
  app: { getVersion: () => "1.0.0", quit: () => undefined },
  Menu: {
    buildFromTemplate: (template: AppMenuItem[]) => makeMenu(template),
    setApplicationMenu: (menu: FakeMenu) => void recorded.menus.push(menu),
  },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {
    showMessageBox: (box: MessageBox) => {
      recorded.boxes.push(box);
      return Promise.resolve({ response: recorded.response });
    },
  },
};

/** The menu bar on screen now. */
export function current(): FakeMenu {
  const menu = recorded.menus.at(-1);
  if (menu === undefined) throw new Error("no menu was set");
  return menu;
}

/** One entry of the menu bar on screen, by its label. */
export function entry(top: string, label: string): AppMenuItem | undefined {
  const bar = current().template;
  return bar.find((item) => item.label === top)?.submenu?.find((item) => item.label === label);
}
