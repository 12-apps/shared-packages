import type { Session } from "electron";

import type { LinkState } from "../status";

import type { WindowSpec } from "./windows";

/**
 * What the shell hands the APP when a session appears.
 *
 * Its own module so `./shell` and `./shell-core` can both name it without one
 * importing the other — the two halves are deliberately independent.
 */
export interface ShellContext {
  /**
   * A fetch carrying the agent's session — Electron's `net.fetch` bound to the
   * shell's partition, wrapped so a 401 moves the tray to `signed-out` instead
   * of looking like a network fault (see `../session`).
   */
  fetch: typeof globalThis.fetch;
  /** The host origin, for building URLs. */
  baseUrl: string;
  /** Report the live link. Feeds the tray. */
  setLink(state: LinkState): void;
  /** Report something a PERSON must fix, as a code the host has words for. */
  setFault(code: string | null): void;
  /** Open a window on the shell's partition, hidden-on-close like the rest. */
  openWindow(spec: WindowSpec): void;
  /** The Electron session the agent's own windows should use. */
  session: Session;
}
