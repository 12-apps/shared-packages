import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { app as ElectronApp } from "electron";

import { createAutostart, type Autostart } from "../autostart";

/**
 * The platform ports `../autostart` asks for, filled from Electron and Node.
 *
 * Its own module purely so the port stays testable: everything decided here is
 * "where do the bytes come from", and everything decided THERE — the entry's
 * contents, the path, the read-back — is asserted with no Electron anywhere.
 */
export function createShellAutostart(options: {
  appId: string;
  app: typeof ElectronApp;
  entry: { name: string; comment?: string };
  backgroundArgs: readonly string[];
}): Autostart {
  const { app } = options;
  return createAutostart({
    platform: process.platform,
    id: options.appId,
    entry: {
      name: options.entry.name,
      exec: app.getPath("exe"),
      ...(options.entry.comment === undefined ? {} : { comment: options.entry.comment }),
    },
    backgroundArgs: options.backgroundArgs,
    loginItem: {
      // `identity` forwarded, never dropped: on Windows the read is matched on
      // the executable and its arguments (see `LoginItemPort`).
      getLoginItemSettings: (identity) => app.getLoginItemSettings(identity),
      setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
    },
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
}
