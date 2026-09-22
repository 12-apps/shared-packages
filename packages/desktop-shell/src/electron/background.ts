/**
 * Was this process started BY the machine, or by a person?
 *
 * The answer decides one thing and it is the thing that gets an agent
 * uninstalled: whether a window opens. Started at login, an agent must appear
 * as a tray icon and nothing else — a window that takes focus every time
 * somebody boots their computer is not a feature, it is an interruption at the
 * worst possible moment of the day.
 *
 * There is no portable way to ask, so both mechanisms are read:
 *
 *  - the ARGUMENT the autostart entry was registered with — the only signal
 *    that exists on Windows and Linux, and the reason
 *    `AutostartOptions.backgroundArgs` is part of that API;
 *  - macOS's `wasOpenedAtLogin`, which is authoritative there and covers a
 *    login item a person re-created through System Settings, where no argument
 *    of ours survives.
 */

/** The argument this package suggests, and the one its tests pin. */
export const BACKGROUND_FLAG = "--background";

export function startedInBackground(
  argv: readonly string[],
  options: { flag?: string; wasOpenedAtLogin?: boolean } = {},
): boolean {
  if (options.wasOpenedAtLogin === true) return true;
  return argv.includes(options.flag ?? BACKGROUND_FLAG);
}
