import {
  autostartFilePath,
  desktopEntryFile,
  type DesktopEntry,
} from "./desktop-entry";

/**
 * `@12-apps/desktop-shell/autostart` — "start with the machine", on all three.
 *
 * An agent that has to be launched by hand is an agent that is not running on
 * the morning somebody needed it. But the feature is three different features
 * wearing one name:
 *
 * | | how it is stored | who writes it |
 * |---|---|---|
 * | **macOS** | a login item in the user's session | Electron (`setLoginItemSettings`) |
 * | **Windows** | a `Run` key under `HKCU` | Electron (same call) |
 * | **Linux** | a `.desktop` file under `~/.config/autostart` | us — Electron does not implement it here |
 *
 * So this module is a port with two implementations behind one question, and
 * both are injected: the tests run the Linux half against an in-memory file
 * system and the other half against a recording double, on a machine with no
 * desktop session at all.
 */
export {
  autostartFilePath,
  desktopEntryFile,
  quoteExecArgument,
  type DesktopEntry,
} from "./desktop-entry";

/** Electron's `app` login-item surface, narrowed to what is used. */
export interface LoginItemPort {
  getLoginItemSettings(): { openAtLogin: boolean };
  setLoginItemSettings(settings: {
    openAtLogin: boolean;
    openAsHidden?: boolean;
    args?: string[];
  }): void;
}

/** The file operations the Linux half needs. */
export interface FilePort {
  exists(path: string): Promise<boolean>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export interface AutostartOptions {
  /** `process.platform`. Anything but `linux` takes the login-item path. */
  platform: string;
  /** Reverse-DNS-ish id; also the Linux file's basename. */
  id: string;
  /** What the entry is called, and optionally described. The HOST's copy. */
  entry: Omit<DesktopEntry, "args">;
  /**
   * The flag that tells a launched-by-the-session process to stay invisible.
   *
   * Both halves need it and neither can infer it: on macOS `openAsHidden` is a
   * hint the app may ignore, on Windows there is no such concept at all, and
   * on Linux nothing is implied. So the app reads its own argv, and this is
   * what puts the argument there.
   */
  backgroundArgs?: readonly string[];
  loginItem?: LoginItemPort;
  files?: FilePort;
  env?: { XDG_CONFIG_HOME?: string; HOME?: string };
}

export interface Autostart {
  isEnabled(): Promise<boolean>;
  enable(): Promise<void>;
  disable(): Promise<void>;
  /** Flip to `next`. The shape a settings checkbox actually calls. */
  set(next: boolean): Promise<void>;
}

/**
 * A no-op autostart, for a platform whose port was not supplied.
 *
 * Deliberately silent rather than throwing: a packaged Linux build that ships
 * without the file port, or a dev run under `electron .` where enabling it
 * would register the DEV binary at login, should answer "off" and change
 * nothing. A host that wants the difference surfaced reads `isEnabled` back
 * after setting it — which is the only honest check on any of the three
 * platforms anyway.
 */
const DISABLED: Autostart = {
  isEnabled: () => Promise.resolve(false),
  enable: () => Promise.resolve(),
  disable: () => Promise.resolve(),
  set: () => Promise.resolve(),
};

export function createAutostart(options: AutostartOptions): Autostart {
  const args = [...(options.backgroundArgs ?? [])];
  if (options.platform === "linux") {
    const { files } = options;
    if (!files) return DISABLED;
    const path = autostartFilePath(options.id, options.env ?? {});
    const content = (exec: string): string =>
      desktopEntryFile({ ...options.entry, exec, args });
    const enable = async (): Promise<void> => {
      await files.write(path, content(options.entry.exec));
    };
    const disable = async (): Promise<void> => {
      await files.remove(path);
    };
    return {
      isEnabled: () => files.exists(path),
      enable,
      disable,
      set: (next) => (next ? enable() : disable()),
    };
  }

  const { loginItem } = options;
  if (!loginItem) return DISABLED;
  const enable = (): Promise<void> => {
    loginItem.setLoginItemSettings({ openAtLogin: true, openAsHidden: true, args });
    return Promise.resolve();
  };
  const disable = (): Promise<void> => {
    // The args go with it. A `Run` key left behind pointing at a build that
    // has since been replaced is how an uninstalled agent still tries to start.
    loginItem.setLoginItemSettings({ openAtLogin: false, args: [] });
    return Promise.resolve();
  };
  return {
    isEnabled: () => Promise.resolve(loginItem.getLoginItemSettings().openAtLogin),
    enable,
    disable,
    set: (next) => (next ? enable() : disable()),
  };
}
