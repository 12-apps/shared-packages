import type { UpdateState } from "./manager";

/**
 * An update that installs itself.
 *
 * "It installs when you close the program" does not survive contact with a
 * tray agent: closing the window only hides it to the tray, nobody quits a
 * tray program on purpose, and a downloaded version can sit unreached through
 * a quit, a reopen and a "restart and update" nobody pressed. So once a
 * version is on disk and the "update by itself" switch is on, the agent
 * restarts into it by itself.
 *
 * Never in the middle of work: an attempt that finds work in progress waits
 * and tries again. A restart costs a few seconds, and a host whose work is
 * queued server-side loses nothing in them.
 */

/** How long a version sits "ready" on screen before the restart. */
export const INSTALL_GRACE_MS = 15_000;
/** How often an attempt that found work in progress tries again. */
export const INSTALL_RETRY_MS = 5_000;

interface AutoInstallOptions {
  /** The "update by itself" switch, read at the moment of the attempt. */
  autoUpdate: () => boolean;
  /** Whether work the restart must not cut is in progress right now. */
  busy: () => boolean;
  /**
   * A version that already failed to install on this machine. Never retried
   * automatically: an installer that fails every time would otherwise quit the
   * agent on every boot and leave the machine with no agent at all. The
   * host's own "restart and update" action still offers it.
   */
  failedBefore?: () => string | null;
  /** Restart into the version on disk. */
  install: (version: string) => void;
  /** One-shot timer, swapped in tests. */
  later?: (run: () => void, ms: number) => void;
}

/** Feed it every updater state; it restarts once a version is ready. */
export function createAutoInstall(options: AutoInstallOptions): (state: UpdateState) => void {
  const later = options.later ?? ((run, ms) => void setTimeout(run, ms));
  let scheduled: string | null = null;

  const attempt = (version: string): void => {
    if (!options.autoUpdate()) {
      // Turned off while it waited: the person has the button.
      scheduled = null;
      return;
    }
    if (options.busy()) {
      later(() => attempt(version), INSTALL_RETRY_MS);
      return;
    }
    options.install(version);
  };

  return (state) => {
    if (state.kind !== "ready" || scheduled === state.version) return;
    if (!options.autoUpdate()) return;
    if (options.failedBefore?.() === state.version) return;
    scheduled = state.version;
    later(() => attempt(state.version), INSTALL_GRACE_MS);
  };
}
