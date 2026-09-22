import { app, session } from "electron";

import type { Autostart } from "../autostart";
import type { SessionWatch } from "../session";
import type { ShellState, ShellStatus } from "../status";

import { createShellAutostart } from "./autostart-adapter";
import { BACKGROUND_FLAG, startedInBackground } from "./background";
import { createShellCore } from "./shell-core";
import { createTrayController } from "./tray-controller";
import type { TrayCopy } from "./tray-menu";
import type { ShellContext } from "./types";
import { createWindowManager } from "./windows";

/**
 * The shell: one tray icon, one session, one place windows come from.
 *
 * ```ts
 * app.whenReady().then(async () => {
 *   const shell = await startDesktopShell({ …, onSignedIn: (ctx) => agent.start(ctx) });
 *   if (!shell) return;              // a second copy — the first was raised
 * });
 * ```
 *
 * `onSignedIn` is where the APP lives. Everything above it is the same for
 * every agent built on this package, which is the entire reason it is one.
 *
 * This file is ORCHESTRATION only. Every decision sits where it can be
 * asserted without a display: the menu's contents in `./tray-menu`, the
 * hide-on-close rule in `./windows`, the platform ports in
 * `./autostart-adapter`, the session and status in `./shell-core`, and the
 * status ranking in `../status`.
 */
export type { ShellContext } from "./types";

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
  /** Preload for that page, and that page ONLY — never the sign-in window. */
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

/** Keys the shell's own two windows are filed under. */
const SIGN_IN = "sign-in";
const SETTINGS = "settings";

/**
 * Start the shell, or answer `null` when this process is a SECOND copy.
 *
 * Two copies of an agent is not a cosmetic problem: both hold the same
 * subscription, both claim the same work, and the shop gets everything twice.
 * The lock is taken before anything else exists, and the already-running copy
 * raises its window so the double-click the person just made looks like it
 * worked.
 */
export async function startDesktopShell(
  options: DesktopShellOptions,
): Promise<DesktopShell | null> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }

  // The dock icon is noise for something that lives in the tray, and macOS is
  // the only platform that shows one. Guarded because `app.dock` is undefined
  // elsewhere, where reading `.hide()` would throw during startup.
  app.dock?.hide();

  const shellSession = session.fromPartition(`persist:${options.appId}`);
  const windows = createWindowManager(shellSession);
  const autostart = createShellAutostart({
    appId: options.appId,
    app,
    entry: {
      name: options.autostart?.name ?? options.appId,
      ...(options.autostart?.comment === undefined ? {} : { comment: options.autostart.comment }),
    },
    backgroundArgs: [BACKGROUND_FLAG],
  });
  const core = createShellCore(coreOptions(options, shellSession, windows));
  const shell = shellApi(options, windows, core, autostart);

  const tray = await createTrayController({
    copy: options.tray.copy,
    icons: options.tray.icons,
    autostart,
    status: () => core.status(),
    actions: {
      signIn: () => shell.showSignIn(),
      signOut: () => void shell.signOut(),
      settings: () => shell.showSettings(),
      quit: () => {
        windows.beginQuit();
        app.quit();
      },
    },
  });
  core.onRender((status) => tray.render(status));

  wireLifecycle(shell, windows.beginQuit, () => core.watch.stop());

  await core.watch.start();
  if (core.watch.state === "signed-out" && !startedInBackground(process.argv)) shell.showSignIn();
  return shell;
}

/**
 * The core's options, with the host's three optional callbacks passed through
 * only when it supplied them.
 *
 * Spelled out here rather than inline because `exactOptionalPropertyTypes`
 * makes each one a conditional spread, and four of those in the middle of the
 * start sequence hid what the sequence actually is.
 */
function coreOptions(
  options: DesktopShellOptions,
  shellSession: ReturnType<typeof session.fromPartition>,
  windows: ReturnType<typeof createWindowManager>,
): Parameters<typeof createShellCore>[0] {
  return {
    baseUrl: options.baseUrl,
    cookieName: options.cookieName,
    shellSession,
    windows,
    signInKey: SIGN_IN,
    ...(options.onSignedIn === undefined ? {} : { onSignedIn: options.onSignedIn }),
    ...(options.onSignedOut === undefined ? {} : { onSignedOut: options.onSignedOut }),
    ...(options.onStatus === undefined ? {} : { onStatus: options.onStatus }),
  };
}

/** The object a host holds: every entry a window, a session or the autostart. */
function shellApi(
  options: DesktopShellOptions,
  windows: ReturnType<typeof createWindowManager>,
  core: ReturnType<typeof createShellCore>,
  autostart: Autostart,
): DesktopShell {
  return {
    get status(): ShellStatus {
      return core.status();
    },
    context: core.context,
    showSignIn: () =>
      void windows.open({
        key: SIGN_IN,
        url: new URL(options.signInPath, options.baseUrl).toString(),
        width: 520,
        height: 680,
      }),
    showSettings: () =>
      void windows.open({
        key: SETTINGS,
        url: options.settingsUrl,
        width: 720,
        height: 640,
        ...(options.settingsPreload === undefined ? {} : { preload: options.settingsPreload }),
      }),
    signOut: () => core.watch.signOut(),
    autostart,
    sessionWatch: core.watch,
  };
}

/**
 * The three app-level events an agent must not inherit the defaults of.
 *
 * `window-all-closed` is the one that matters: Electron quits on it, which for
 * something whose job is to keep working with nothing on screen is exactly
 * backwards.
 */
function wireLifecycle(shell: DesktopShell, beginQuit: () => void, stopWatch: () => void): void {
  app.on("second-instance", () =>
    shell.status === "signed-out" ? shell.showSignIn() : shell.showSettings(),
  );
  app.on("window-all-closed", () => {
    /* stay resident: the tray is the app */
  });
  app.on("before-quit", () => {
    beginQuit();
    stopWatch();
  });
}
