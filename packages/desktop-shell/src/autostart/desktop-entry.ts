/**
 * The XDG autostart entry — how "start with the machine" is spelled on Linux.
 *
 * Windows and macOS both have an API for this and Electron wraps both
 * (`app.setLoginItemSettings`). Linux has neither: the desktop environment
 * reads `$XDG_CONFIG_HOME/autostart/*.desktop` at session start, so the
 * feature IS a file, and writing it correctly is this module's whole job.
 *
 * Pure string work on purpose — the quoting below is the part that breaks, and
 * it breaks on a machine nobody is testing on, so it is asserted here rather
 * than discovered by a shop owner whose user name has a space in it.
 */

export interface DesktopEntry {
  /** Shown in the desktop environment's own startup-applications list. */
  name: string;
  /** Absolute path to the binary. */
  exec: string;
  /** Arguments — the flag that tells the app it was started by the session. */
  args?: readonly string[];
  /** One line for the same list. The host's copy, in the host's language. */
  comment?: string;
}

/**
 * Quote one `Exec` argument per the Desktop Entry Specification.
 *
 * The spec's reserved set is not the shell's: a backslash is doubled, and `$`
 * and a backtick are escaped INSIDE the quotes because the value is passed
 * through a shell-like unquoting even though no shell runs. An AppImage under
 * `/home/maria da silva/Apps/` is the case that makes this mandatory rather
 * than tidy — unquoted, the session starts `/home/maria` and reports nothing.
 */
export function quoteExecArgument(value: string): string {
  const escaped = value.replace(/(["`$\\])/g, "\\$1");
  return `"${escaped}"`;
}

/** The file content a desktop environment reads at session start. */
export function desktopEntryFile(entry: DesktopEntry): string {
  const command = [entry.exec, ...(entry.args ?? [])].map(quoteExecArgument).join(" ");
  const lines = [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${sanitizeValue(entry.name)}`,
    `Exec=${command}`,
    // No window opens at login: the agent's job is to be invisible until the
    // tray is clicked, and a window appearing on every boot is the single
    // fastest way to get an agent uninstalled.
    "Terminal=false",
    // `Hidden=true` means "this entry is switched off" — the opposite of what
    // the word suggests, and the mistake worth pinning in a test.
    "Hidden=false",
    // GNOME honours its own key and ignores the entry without it on some
    // versions; every other environment ignores the key. Cheap either way.
    "X-GNOME-Autostart-enabled=true",
  ];
  if (entry.comment !== undefined) lines.push(`Comment=${sanitizeValue(entry.comment)}`);
  return `${lines.join("\n")}\n`;
}

/**
 * The environment, in the shape `process.env` actually has.
 *
 * Deliberately the WHOLE map rather than the two keys that are read. A type
 * whose properties are all optional is a *weak type*, and TypeScript refuses
 * an argument that shares none of its properties — an index signature alone
 * is forgiven, an index signature plus one declared key is not. That is
 * exactly `@types/node`'s `ProcessEnv` up to 22.19.x, where it carries
 * `TZ?: string`, so the narrow shape compiled here and then failed in the
 * first strict host that had the older types. Naming the two keys bought a
 * doc comment and cost every caller a hand-written destructure.
 *
 * The keys read are `XDG_CONFIG_HOME` and `HOME`; `autostartFilePath` below
 * is the only thing that reads them.
 */
export type AutostartEnv = Readonly<Record<string, string | undefined>>;

/**
 * Where that file goes.
 *
 * `XDG_CONFIG_HOME` first, because a machine that sets it means it, and
 * `~/.config` otherwise — the default the spec states.
 */
export function autostartFilePath(id: string, env: AutostartEnv): string {
  const base = env.XDG_CONFIG_HOME ?? `${env.HOME ?? ""}/.config`;
  return `${base}/autostart/${id}.desktop`;
}

/**
 * A value in a key=value line cannot carry a newline.
 *
 * Not defensive coding: the name and comment are the HOST's strings, and a
 * host that interpolates a store name into them has handed this function
 * whatever somebody typed into a settings field. A stray newline there would
 * append arbitrary keys to the entry.
 */
function sanitizeValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}
