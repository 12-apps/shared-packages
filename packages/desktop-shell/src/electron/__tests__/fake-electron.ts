import type { AppMenuItem } from "../../updates";

/**
 * A stand-in for the slice of `electron` the menu adapter touches.
 *
 * `electron` cannot be imported outside an Electron runtime, so the adapter's
 * tests replace the module with this (`vi.mock("electron", …)`) and read what
 * it recorded: every menu set, every message box shown, and which window each
 * was parented to.
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
  type?: string;
  defaultId?: number;
  cancelId?: number;
}

/**
 * A message box as shown: whether it was asked for in the window form
 * (`showMessageBox(window, options)`) and the window it was parented to.
 */
interface ShownBox extends MessageBox {
  parented: boolean;
  owner: object | null;
}

export const recorded = {
  /** Every menu handed to `setApplicationMenu`, oldest first. */
  menus: [] as FakeMenu[],
  boxes: [] as ShownBox[],
  /** The button the next message box answers with. */
  response: 0,
  /** The window `BrowserWindow.getFocusedWindow()` answers with; none by default. */
  focused: null as object | null,
  /** The next message box is answered with this button. */
  answer(response: number): void {
    this.response = response;
  },
  /** `BrowserWindow.getFocusedWindow()` answers with this window from now on. */
  putInFront(window: object | null): void {
    this.focused = window;
  },
  reset(): void {
    this.menus.length = 0;
    this.boxes.length = 0;
    this.response = 0;
    this.focused = null;
  },
};

export const electronModule = {
  app: { getVersion: () => "1.0.0", quit: () => undefined },
  Menu: {
    buildFromTemplate: (template: AppMenuItem[]) => makeMenu(template),
    setApplicationMenu: (menu: FakeMenu) => void recorded.menus.push(menu),
  },
  BrowserWindow: { getFocusedWindow: () => recorded.focused },
  dialog: {
    // Electron's two forms: `(options)`, and `(window, options)` to parent the box to a window.
    showMessageBox: (...args: [MessageBox] | [object, MessageBox]) => {
      const [owner, box] = args.length === 2 ? args : [null, args[0]];
      recorded.boxes.push({ ...box, owner, parented: args.length === 2 });
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
