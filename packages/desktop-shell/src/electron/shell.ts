import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { app, BrowserWindow, Menu, Tray, net, session, type Session } from "electron";

import { createAutostart, type Autostart } from "../autostart";
import { createSessionWatch, guardSession, type SessionWatch } from "../session";
import {
  deriveShellStatus,
  INITIAL_SHELL_STATE,
  type LinkState,
  type ShellState,
  type ShellStatus,
} from "../status";

import { startedInBackground } from "./background";
import { buildTrayMenu, type TrayCopy } from "./tray-menu";

/**
 * The shell: one tray icon, one session, one place windows come from.
 *
 * ## The shape of a call
 *
 * ```ts
 * app.whenReady().then(async () => {
 *   const shell = await startDesktopShell({ … , onSignedIn: (ctx) => agent.start(ctx) });
 *   if (!shell) return;              // a second copy — the first was raised
 * });
 * ```
 *
 * `onSignedIn` is where the APP lives. Everything above it is the same for
 * every agent built on this package, which is the entire reason it is a
 * package.
 *
 * ## Windows are hidden, never closed
 *
 * Closing the last window of an ordinary app quits it. For an agent that is
 * exactly wrong — the work is the point and the window is a visit — so every
 * window here intercepts its own close and hides instead, and the only way out
 * is the tray's Quit. That single behaviour is what makes it a background app
 * rather than an app somebody has to leave open.
 */
export interface ShellContext {
  /**
   * A fetch carrying the agent's session.
   *
   * Electron's `net.fetch` bound to the shell's own partition, so the cookie
   * the sign-in window obtained rides every request with nothing to copy — and
   * wrapped so a 401 moves the tray to `signed-out` instead of looking like a
   * network fault (see `../session`).
   */
  fetch: typeof globalThis.fetch;
  /** The host origin, for building URLs. */
  baseUrl: string;
  /** Report the live link. Feeds the tray. */
  setLink(state: LinkState): void;
  /** Report something a PERSON must fix, as a code the host has words for. */
  setFault(code: string | null): void;
  /** Open a window on the shell's partition, hidden-on-close like the rest. */
  openWindow(options: {
    url: string;
    width?: number;
    height?: number;
    title?: string;
    /** Absolute path to a preload script, for a window of the app's OWN. */
    preload?: string;
  }): void;
  /** The Electron session the agent's own windows should use. */
  session: Session;
}

export interface DesktopShellOptions {
  /** Reverse-DNS id. Names the partition and the Linux autostart file. */
  appId: string;
  /** The host origin — `https://admin.example.com`. */
  baseUrl: string;
  /** Where the host's own sign-in page lives, relative to {@link baseUrl}. */
  signInPath: string;
  /** The session cookie's name, from the host's auth library. See `../session`. */
  cookieName: string;
  tray: {
    copy: TrayCopy;
    /** An icon file path per status. The host's artwork, in the host's brand. */
    icons: Record<ShellStatus, string>;
  };
  /** Opened by the tray's settings entry. The app's own page. */
  settingsUrl: string;
  /**
   * Preload for that page, and for that page ONLY.
   *
   * Never reaches the sign-in window, which loads the host's own page over the
   * network: a bridge exposed there would be reachable by whatever that origin
   * is serving, which is the one window in an agent that must stay a plain
   * browser.
   */
  settingsPreload?: string;
  autostart?: {
    /** Shown in the desktop environment's startup list. Host copy. */
    name: string;
    comment?: string;
  };
  /** Runs when a session appears. The app's own work starts here. */
  onSignedIn?: (context: ShellContext) => void | Promise<void>;
  /** Runs when the session goes away. Stop the work; the shell stays up. */
  onSignedOut?: () => void | Promise<void>;
  /** Every status transition, for a host that logs them. */
  onStatus?: (status: ShellStatus, state: ShellState) => void;
}

export interface DesktopShell {
  readonly status: ShellStatus;
  readonly context: ShellContext;
  showSignIn(): void;
  showSettings(): void;
  signOut(): Promise<void>;
  autostart: Autostart;
  sessionWatch: SessionWatch;
}

/**
 * Start the shell, or answer `null` when this process is a SECOND copy.
 *
 * Two copies of an agent is not a cosmetic problem: both hold the same
 * subscription, both claim the same work, and the shop gets everything twice.
 * The lock is therefore taken before anything else exists, and the already-
 * running copy raises its window so the double-click the person just made
 * looks like it worked.
 */
export async function startDesktopShell(
  options: DesktopShellOptions,
): Promise<DesktopShell | null> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }

  const partition = `persist:${options.appId}`;
  const shellSession = session.fromPartition(partition);
  const state: ShellState = { ...INITIAL_SHELL_STATE };
  const windows = new Map<string, BrowserWindow>();
  let tray: Tray | null = null;
  let quitting = false;

  // The dock icon is noise for something that lives in the tray, and macOS is
  // the only platform that shows one. Guarded because `app.dock` is undefined
  // elsewhere, where reading `.hide()` would throw during startup.
  app.dock?.hide();

  const autostart = createAutostart({
    platform: process.platform,
    id: options.appId,
    entry: {
      name: options.autostart?.name ?? options.appId,
      exec: app.getPath("exe"),
      ...(options.autostart?.comment === undefined ? {} : { comment: options.autostart.comment }),
    },
    backgroundArgs: ["--background"],
    loginItem: { getLoginItemSettings: () => app.getLoginItemSettings(), setLoginItemSettings: (s) => app.setLoginItemSettings(s) },
    files: {
      exists: (path) => Promise.resolve(existsSync(path)),
      write: async (path, content) => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, content, "utf8");
      },
      // `force` so disabling an autostart that was never enabled is a no-op
      // rather than the ENOENT a settings checkbox would surface as a failure.
      remove: (path) => rm(path, { force: true }),
    },
    env: process.env,
  });
  let autostartEnabled = await autostart.isEnabled();

  function openWindow(spec: {
    key?: string;
    url: string;
    width?: number;
    height?: number;
    title?: string;
    preload?: string;
  }): BrowserWindow {
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
        // The sign-in window loads the HOST's page, so it is the web's own
        // security posture that applies: no node, context isolated, sandboxed.
        // An agent that relaxed these to make one window convenient would be
        // handing that page the operating system.
        session: shellSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        ...(spec.preload === undefined ? {} : { preload: spec.preload }),
      },
    });
    window.once("ready-to-show", () => window.show());
    window.on("close", (event) => {
      // Hidden, never destroyed — see the class docblock. Once the app is
      // actually quitting the interception has to stop, or Quit does nothing.
      if (quitting) return;
      event.preventDefault();
      window.hide();
    });
    windows.set(key, window);
    void window.loadURL(spec.url);
    return window;
  }

  const context: ShellContext = {
    fetch: guardSession(
      // Bound to the partition, so the sign-in window's cookie is on every
      // request. A plain `globalThis.fetch` here would share nothing with the
      // window and be permanently signed out.
      (input, init) => net.fetch(input as never, init as never) as unknown as Promise<Response>,
      () => {
        // The server has the last word on a session, ahead of any cookie we
        // can see: re-reading the jar is what turns its refusal into the tray
        // state and stops the work.
        void watch.refresh();
      },
    ),
    baseUrl: options.baseUrl,
    setLink(link) {
      update({ link });
    },
    setFault(fault) {
      update({ fault });
    },
    openWindow: (spec) => void openWindow(spec),
    session: shellSession,
  };

  const watch = createSessionWatch({
    jar: shellSession.cookies,
    spec: { url: options.baseUrl, cookieName: options.cookieName },
    onChange: (session_) => {
      update({ session: session_ });
      if (session_ === "signed-in") {
        // The window has done its job; leaving a sign-in page open behind a
        // successful sign-in is how somebody signs in twice.
        windows.get("sign-in")?.hide();
        void options.onSignedIn?.(context);
      } else if (session_ === "signed-out") {
        update({ link: "disconnected", fault: null });
        void options.onSignedOut?.();
      }
    },
  });

  function update(patch: Partial<ShellState>): void {
    const before = deriveShellStatus(state);
    Object.assign(state, patch);
    const after = deriveShellStatus(state);
    if (after === before) return;
    render();
    options.onStatus?.(after, { ...state });
  }

  function render(): void {
    const status = deriveShellStatus(state);
    if (!tray) return;
    tray.setImage(options.tray.icons[status]);
    tray.setToolTip(options.tray.copy.status[status]);
    tray.setContextMenu(
      Menu.buildFromTemplate(
        buildTrayMenu({
          status,
          copy: options.tray.copy,
          autostartEnabled,
          autostartSupported: true,
          actions: {
            signIn: () => shell.showSignIn(),
            signOut: () => void shell.signOut(),
            settings: () => shell.showSettings(),
            toggleAutostart: () => {
              void (async (): Promise<void> => {
                await autostart.set(!autostartEnabled);
                // Read BACK rather than assume: on every platform this can
                // fail silently (a policy, a read-only home, a sandbox), and a
                // checkbox that ticks itself on a change that did not happen is
                // worse than one that refuses to move.
                autostartEnabled = await autostart.isEnabled();
                render();
              })();
            },
            quit: () => {
              quitting = true;
              app.quit();
            },
          },
        }),
      ),
    );
  }

  const shell: DesktopShell = {
    get status(): ShellStatus {
      return deriveShellStatus(state);
    },
    context,
    showSignIn(): void {
      openWindow({
        key: "sign-in",
        url: new URL(options.signInPath, options.baseUrl).toString(),
        width: 520,
        height: 680,
      });
    },
    showSettings(): void {
      openWindow({
        key: "settings",
        url: options.settingsUrl,
        width: 720,
        height: 640,
        ...(options.settingsPreload === undefined ? {} : { preload: options.settingsPreload }),
      });
    },
    async signOut(): Promise<void> {
      await watch.signOut();
    },
    autostart,
    sessionWatch: watch,
  };

  tray = new Tray(options.tray.icons.starting);
  // A left click on the icon is the gesture everybody tries first; on Windows
  // and Linux it does nothing unless it is wired, and on macOS it opens the
  // menu already.
  tray.on("click", () => (shell.status === "signed-out" ? shell.showSignIn() : shell.showSettings()));
  render();

  app.on("second-instance", () => {
    if (shell.status === "signed-out") shell.showSignIn();
    else shell.showSettings();
  });
  // Without this an agent quits the moment somebody closes its settings
  // window on Windows and Linux — the default every Electron app inherits and
  // the exact opposite of what a background app means.
  app.on("window-all-closed", () => {
    /* stay resident: the tray is the app */
  });
  app.on("before-quit", () => {
    quitting = true;
    watch.stop();
  });

  await watch.start();
  if (watch.state === "signed-out" && !startedInBackground(process.argv)) shell.showSignIn();
  return shell;
}
