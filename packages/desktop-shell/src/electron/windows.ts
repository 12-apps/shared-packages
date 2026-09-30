import { BrowserWindow, type Session } from "electron";

/**
 * Every window the shell opens, and the ONE behaviour that makes an agent an
 * agent: a window HIDES when it is closed.
 *
 * Electron quits an app when its last window closes. For something whose whole
 * job is to keep working with nothing on screen that is exactly backwards — so
 * every window here intercepts its own `close`, and the tray's Quit is the only
 * way out. The interception has to stop once the app really is quitting, or
 * Quit does nothing at all, which is what {@link WindowManager.beginQuit} is
 * for.
 */

export interface WindowSpec {
  /** Identity, so asking twice raises the one that is open. Defaults to `url`. */
  key?: string;
  url: string;
  width?: number;
  height?: number;
  title?: string;
  /**
   * Absolute path to a preload script, for a window of the APP's own.
   *
   * Never passed to a window that loads the host's page over the network: a
   * bridge exposed there would be reachable by whatever that origin serves,
   * and the sign-in window is the one place in an agent that must stay a plain
   * browser.
   */
  preload?: string;
}

export interface WindowManager {
  open(spec: WindowSpec): BrowserWindow;
  hide(key: string): void;
  /** Stop intercepting `close`, so `app.quit()` can actually finish. */
  beginQuit(): void;
}

export function createWindowManager(shellSession: Session): WindowManager {
  const windows = new Map<string, BrowserWindow>();
  const state = { quitting: false };

  return {
    open(spec: WindowSpec): BrowserWindow {
      const key = spec.key ?? spec.url;
      const existing = windows.get(key);
      if (existing && !existing.isDestroyed()) {
        existing.show();
        existing.focus();
        return existing;
      }
      const window = new BrowserWindow({
        width: spec.width ?? 960,
        height: spec.height ?? 720,
        show: false,
        ...(spec.title === undefined ? {} : { title: spec.title }),
        webPreferences: {
          // The sign-in window loads the HOST's page, so the web's own security
          // posture applies: no node, context isolated, sandboxed. An agent that
          // relaxed these to make one window convenient would be handing that
          // page the operating system.
          session: shellSession,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          ...(spec.preload === undefined ? {} : { preload: spec.preload }),
        },
      });
      window.once("ready-to-show", () => window.show());
      window.on("close", (event) => {
        if (state.quitting) return;
        event.preventDefault();
        window.hide();
      });
      windows.set(key, window);
      void window.loadURL(spec.url);
      return window;
    },
    hide(key: string): void {
      const window = windows.get(key);
      if (window && !window.isDestroyed()) window.hide();
    },
    beginQuit(): void {
      state.quitting = true;
    },
  };
}
