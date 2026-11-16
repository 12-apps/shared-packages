/**
 * "Store mode": the app was installed from the Microsoft Store as an MSIX.
 *
 * Electron sets `process.windowsStore` to `true` there. Two things the shell
 * does everywhere else belong to Windows in that package, and are left alone:
 *
 * - **Updates.** The Store replaces the app; an updater of our own would
 *   download an installer the MSIX sandbox refuses to run.
 * - **Start with the computer.** Windows owns it (Settings › Apps › Startup);
 *   `app.setLoginItemSettings` does nothing inside an MSIX package.
 *
 * Nothing changes outside Store mode (Windows `.exe`, macOS, Linux).
 */

/** The slice of `process` this reads, so a test hands in a fake. */
export interface StoreProcess {
  windowsStore?: boolean;
}

/** Whether this process runs from a Microsoft Store (MSIX) install. */
export function isWindowsStoreApp(proc: StoreProcess = process): boolean {
  return proc.windowsStore === true;
}
