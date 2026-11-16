import { SYSTEM_STARTUP_SETTINGS_URL, type Autostart } from "../autostart";

/**
 * What a click on the tray's "start with the machine" entry does.
 *
 * Its own module so the decision is asserted with no tray and no Electron.
 *
 *  - **Normally** it flips autostart and reads the answer BACK: every platform
 *    can refuse silently (a policy, a read-only home, a sandbox), and a
 *    checkbox that ticks itself on a change that did not happen is worse than
 *    one that refuses to move.
 *  - **When the system owns the switch** (`Autostart.managedBySystem`, a
 *    Microsoft Store install) it changes nothing and opens the system's own
 *    startup settings instead; `onToggled` is not called, since nothing was
 *    chosen here.
 */
interface AutostartToggleOptions {
  autostart: Autostart;
  /** Electron's `shell.openExternal`. */
  openExternal: (url: string) => Promise<void>;
  /** Read autostart back and repaint. */
  refresh: () => Promise<void>;
  /** After a real flip: a choice the host may record. */
  onToggled?: () => void | Promise<void>;
  /** The state the checkbox shows now. */
  enabled: () => boolean;
}

export function createAutostartToggle(options: AutostartToggleOptions): () => Promise<void> {
  return async () => {
    if (options.autostart.managedBySystem === true) {
      // Caught: a refused handler must not become an unhandled rejection in a
      // tray process. The repaint puts the checkbox back where it was.
      await options.openExternal(SYSTEM_STARTUP_SETTINGS_URL).catch(() => undefined);
      await options.refresh();
      return;
    }
    await options.autostart.set(!options.enabled());
    await options.refresh();
    await options.onToggled?.();
  };
}
