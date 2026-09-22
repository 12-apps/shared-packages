/**
 * What a background agent is doing, in the only vocabulary its tray can draw.
 *
 * An agent has no screen anybody watches. Its entire user interface, most
 * days, is ONE icon and ONE line of text in a system tray — so the status
 * model is not a debugging aid, it is the product. Getting it wrong has a
 * specific shape: a shop owner who cannot tell "working" from "signed out"
 * finds out at the moment the work silently was not done.
 *
 * ## Two independent facts, one derived answer
 *
 * A session and a live link fail separately and recover separately, and an
 * agent that collapsed them into one boolean could not tell a person which of
 * the two to fix. They are tracked apart and {@link deriveShellStatus} is the
 * ONE place they become a single word — so every surface (tray icon, tooltip,
 * window, log line) says the same thing about the same moment.
 */

/** Whether the agent holds a session with the host. */
export type SessionState = "unknown" | "signed-in" | "signed-out";

/**
 * Whether the live link is up.
 *
 * Deliberately `@12-apps/realtime`'s own `RealtimeStatus` spelling rather than
 * a synonym: this value is usually assigned straight from that client's
 * `onStatusChange`, and a translation table between two vocabularies for the
 * same four states is a defect waiting for its third state.
 */
export type LinkState = "connecting" | "connected" | "disconnected" | "unavailable";

/**
 * What the tray shows.
 *
 * `degraded` is the one worth naming carefully. It is NOT an error: the agent
 * is signed in and its fallback — whatever poll the host kept, per the realtime
 * contract — is still running. It means "you are not getting this instantly",
 * which is a different sentence from "this is not happening".
 */
export type ShellStatus =
  | "starting"
  | "signed-out"
  | "faulted"
  | "connecting"
  | "online"
  | "degraded"
  | "stopped";

export interface ShellState {
  session: SessionState;
  link: LinkState;
  /**
   * Something the PERSON has to fix — no printer configured, a device that
   * refuses every job, a disk with nowhere to write.
   *
   * A code, never a sentence: this package ships no copy, and the host turns
   * the code into words in the language of whoever is reading the tray.
   */
  fault: string | null;
  /** Set once the agent is shutting down; nothing recovers from it. */
  stopped: boolean;
}

export const INITIAL_SHELL_STATE: ShellState = {
  session: "unknown",
  link: "connecting",
  fault: null,
  stopped: false,
};

/**
 * Reduce the two facts to the one word the tray draws.
 *
 * The ORDER is the whole of this function, and it is an order of what a person
 * should do next rather than of severity:
 *
 *  1. `stopped` — nothing else is true any more.
 *  2. `starting` — we have not asked yet; claiming either answer would be a guess.
 *  3. `signed-out` — the root cause of everything below it. An agent with no
 *     session also has no link, and reporting the link would send somebody to
 *     debug a network that is fine.
 *  4. `faulted` — signed in, and something local needs a hand. Ranked above the
 *     link because it does not clear on its own, and the link does.
 *  5. the link.
 */
export function deriveShellStatus(state: ShellState): ShellStatus {
  if (state.stopped) return "stopped";
  if (state.session === "unknown") return "starting";
  if (state.session === "signed-out") return "signed-out";
  if (state.fault !== null) return "faulted";
  if (state.link === "connected") return "online";
  if (state.link === "connecting") return "connecting";
  return "degraded";
}

/**
 * Whether this status means the agent is doing its job.
 *
 * `degraded` counts, and that is the point of the predicate existing: a host
 * deciding whether to nag somebody must not nag them over a reconnect that the
 * fallback already covers.
 */
export function isWorking(status: ShellStatus): boolean {
  return status === "online" || status === "degraded";
}
