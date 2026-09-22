/**
 * `@12-apps/desktop-shell` — the reusable half of a background desktop agent.
 *
 * ## What an agent is, and why it needs a package
 *
 * Some work cannot be done by a tab. Reaching a device on the shop's own
 * network, printing without a dialog, surviving a closed browser, starting
 * with the machine — each of those is a thing a web app structurally cannot
 * do, and each is a reason a product eventually grows a small desktop
 * companion.
 *
 * That companion is ~90% the same every time: sign in, stay signed in, keep
 * one connection alive, do the work, survive, tell a person in one icon how it
 * is going, and start at login on three operating systems that each spell that
 * differently. THIS package is that 90%. The app supplies the work.
 *
 * ## Subpaths
 *
 * | Export | What it is |
 * |---|---|
 * | `.` | the status a tray draws, and the supervisor that keeps work alive. Pure. |
 * | `./autostart` | "start with the machine" on macOS, Windows and Linux. |
 * | `./session` | signing in **through the host's own web sign-in page** — no second credential path. |
 * | `./electron` | the adapter: single instance, tray, windows, background start. |
 *
 * Everything but `./electron` is framework-free and runs in a plain Node test.
 *
 * ## It carries no words
 *
 * Not one sentence, in any language. A tray menu, a tooltip and a window title
 * are all copy, and copy is the host's — so the adapter takes a pack. The same
 * rule the rest of these packages follow, and it matters more here: the reader
 * is a shop owner, not a developer, and the words are most of the product.
 */
export {
  deriveShellStatus,
  INITIAL_SHELL_STATE,
  isWorking,
  type LinkState,
  type SessionState,
  type ShellState,
  type ShellStatus,
} from "./status";

export {
  backoffDelay,
  createSupervisor,
  DEFAULT_BACKOFF,
  type BackoffPolicy,
  type Supervisor,
  type SupervisorOptions,
} from "./supervisor";
