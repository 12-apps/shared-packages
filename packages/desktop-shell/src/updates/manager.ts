/**
 * Replacing itself, so a fix does not need a person at the machine.
 *
 * An agent runs on a PC nobody logs into on purpose. Without this, every fix
 * in it costs a phone call asking somebody mid-shift to find a download link,
 * and the honest outcome of that is a machine running whatever build it was
 * installed with for as long as it lasts.
 *
 * ## The feed is the host's, and it may not be anonymous
 *
 * `electron-updater`'s "generic" provider is two plain GETs — a channel file,
 * then the artefact it names — against a URL the HOST decides per check
 * (`settings().feedUrl`). A host that gates its installers behind a session,
 * because an installer anybody can fetch by URL is a thing to point malware
 * at, passes a {@link SessionCookiePort}.
 *
 * That has one consequence worth stating out loud rather than discovering:
 * the updater is a plain Node HTTP client and knows nothing about Electron's
 * cookie jar, so the session has to be handed to it as a header before every
 * check. And an agent that cannot sign in cannot update itself through a gated
 * feed — the recovery for that case is still a person and a new installer.
 *
 * ## Windows and Linux only
 *
 * Squirrel.Mac refuses to install an update whose app is not code-signed, and
 * an agent built without an Apple certificate is not. So macOS reports
 * `unsupported` and says so, rather than checking, finding something and
 * failing at the last step.
 */

import type { OutgoingHttpHeaders } from "node:http";

/** Where the program is in the business of replacing itself, for the window. */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "unsupported" }
  | { kind: "off" }
  | { kind: "checking" }
  | { kind: "none" }
  /**
   * `percent` is null until the first progress event, which is a real state
   * and not a zero: `update-available` fires before a single byte moves, and a
   * bar sitting at 0% reads as stuck rather than as starting.
   */
  | { kind: "downloading"; version: string; percent: number | null }
  | { kind: "ready"; version: string }
  | { kind: "failed" };

/**
 * The slice of `electron-updater`'s `AppUpdater` this uses — the host passes
 * its own `autoUpdater`, so the library is the host's dependency, not this
 * package's.
 *
 * `requestHeaders` is spelled as the library spells it — `OutgoingHttpHeaders`,
 * whose values may be numbers or arrays — rather than the string map this
 * actually writes. A narrower type here reads better and makes the real
 * `autoUpdater` unassignable, which is a seam that fits nothing.
 */
export interface UpdaterPort {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  requestHeaders: OutgoingHttpHeaders | null;
  setFeedURL(options: { provider: "generic"; url: string }): void;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (payload: { version?: string; percent?: number }) => void): void;
}

/**
 * Reading the agent's own session out of the shell's cookie jar, as a whole
 * `name=value` pair. `null` is signed out. See `sessionCookieReader` in
 * `./electron` for the one every Electron host wants.
 */
export interface SessionCookiePort {
  read(): Promise<string | null>;
}

/**
 * Whether this machine can install an update at all.
 *
 * A question about the PLATFORM, asked before anything is downloaded: see the
 * header on why macOS cannot, and note that the answer is "no" rather than
 * "try and see" precisely because the failure would land after the download,
 * on somebody else's machine, at the moment they restarted the program.
 */
export function updatesSupported(platform: NodeJS.Platform): boolean {
  return platform === "win32" || platform === "linux";
}

/**
 * How often a program that lives in a tray asks whether it is out of date.
 *
 * Once a day. The timer is the floor, not the main path: a host also asks
 * every time the agent starts with a session and every time somebody opens its
 * window — the two moments a person is actually looking.
 */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * States a check must not overwrite.
 *
 * A check that is skipped still ANSWERS with a state — `off` when the switch
 * is off, `idle` when signed out — and that answer used to land on top of a
 * download already on disk, taking the "restart and update" action away until
 * the next restart. With a check on every window open that would happen on
 * the next tray click, so these hold until the updater itself moves them.
 * `ready` holds until `install()` restarts into it — by hand, or by itself
 * (`createAutoInstall`).
 *
 * `checking` is deliberately NOT here: the updater emits nothing when it
 * declines to run (an unpackaged build answers `null` in silence), and a state
 * that nothing moves would block every later check. A check in flight is
 * tracked by the call itself instead — see `running`.
 */
const ON_ITS_WAY: ReadonlySet<UpdateState["kind"]> = new Set(["downloading", "ready"]);

export interface UpdateManager {
  /** What to show. */
  readonly state: UpdateState;
  /**
   * Ask now.
   *
   * `manual` is a person choosing "check for updates", and it ignores the
   * switch: somebody who turned automatic updates off and then asked for one
   * has plainly asked for one.
   *
   * A no-op while a check is already running or a version is downloading or
   * ready — see {@link ON_ITS_WAY}. The caller reads `state` for the answer
   * either way.
   */
  check(options?: { manual?: boolean }): Promise<void>;
  /** Restart into the version already on disk. */
  install(): void;
  /** Stop the timer. Idempotent. */
  stop(): void;
}

/** What the host decides, read afresh before every check. */
export interface UpdateSettings {
  /** The "update by itself" switch. A manual check ignores it. */
  autoUpdate: boolean;
  /**
   * The generic-provider feed to ask. `null` is a setup that is not finished
   * — there is nothing to ask yet — and answers `idle`.
   */
  feedUrl: string | null;
}

export interface UpdateManagerOptions {
  /** The host's `autoUpdater` from `electron-updater`, or a fake. */
  updater: UpdaterPort;
  /**
   * The session, for a gated feed. Absent: no header is set and there is no
   * signed-out check — the feed is public.
   */
  cookie?: SessionCookiePort;
  platform: NodeJS.Platform;
  /** Read afresh every time: the feed and the switch both move. */
  settings: () => UpdateSettings;
  /** So the window can be told without being asked. */
  onState?: (state: UpdateState) => void;
  /** Swapped in tests, so a case never waits a day to prove a rule. */
  timers?: TimerPort;
}

/** A repeating timer, narrowed to what this needs and to what a fake can be. */
interface TimerPort {
  set(run: () => void, ms: number): TimerHandle;
  clear(handle: TimerHandle): void;
}

/** `unref` is Node's and absent on a browser-shaped timer — hence optional. */
interface TimerHandle {
  unref?: () => void;
}

/**
 * Wire the updater up and keep asking.
 *
 * Everything the updater is told is re-derived per check — the feed, the
 * session header, whether to ask at all. None of the three is stable across
 * the life of a process that runs for weeks: the feed can move, the cookie
 * rotates, and the switch is the person's to flip.
 */
export function createUpdateManager(options: UpdateManagerOptions): UpdateManager {
  const timers: TimerPort = options.timers ?? {
    set: (run, ms) => globalThis.setInterval(run, ms) as unknown as TimerHandle,
    clear: (handle) => globalThis.clearInterval(handle as unknown as number),
  };
  const held: { state: UpdateState; timer: TimerHandle | null; running: boolean } = {
    state: updatesSupported(options.platform) ? { kind: "idle" } : { kind: "unsupported" },
    timer: null,
    // A double-click on the tray shows the window twice in a row; one check
    // is the answer to both.
    running: false,
  };

  const move = (next: UpdateState): void => {
    held.state = next;
    options.onState?.(next);
  };

  listen(options.updater, move, () => held.state);
  // Downloaded in the background; installed by `install()` only. Installing
  // on quit never happens to a tray program — nobody quits one — and it
  // installs with no record that it tried, so a failure is invisible. Every
  // install goes through the explicit path, which the crash reports follow.
  options.updater.autoDownload = true;
  options.updater.autoInstallOnAppQuit = false;

  const run = async (manual: boolean): Promise<void> => {
    // A cookie read that rejects is a failed check, not an unhandled rejection
    // in a tray process.
    const decision = await prepare(options, manual).catch((): UpdateState => ({ kind: "failed" }));
    if (decision !== null) {
      move(decision);
      return;
    }
    move({ kind: "checking" });
    try {
      await options.updater.checkForUpdates();
    } catch {
      // Never thrown onward: a machine with no internet for an hour is
      // ordinary, and an unhandled rejection in a tray process takes the
      // agent's work down with it. The next tick asks again.
      move({ kind: "failed" });
    }
  };

  const manager: UpdateManager = {
    get state(): UpdateState {
      return held.state;
    },

    check: async (checkOptions) => {
      if (held.running || ON_ITS_WAY.has(held.state.kind)) return;
      held.running = true;
      try {
        await run(checkOptions?.manual === true);
      } finally {
        held.running = false;
      }
    },

    // Silent, and back up afterwards: a one-click per-user installer has
    // nothing to show, and a program that updated itself must be running
    // again when somebody next looks.
    install: () => options.updater.quitAndInstall(true, true),

    stop: () => {
      if (held.timer !== null) timers.clear(held.timer);
      held.timer = null;
    },
  };

  if (updatesSupported(options.platform)) {
    held.timer = timers.set(() => void manager.check(), CHECK_EVERY_MS);
    // So a pending timer never holds the process open on quit.
    held.timer.unref?.();
  }

  return manager;
}

/**
 * Everything that has to be true before a check, or the reason it will not be.
 *
 * `null` means go. A returned state is the answer to show instead, and each
 * one is a different thing for the person: a machine that cannot, a switch
 * that is off, a setup that is unfinished, a session that has gone.
 */
async function prepare(options: UpdateManagerOptions, manual: boolean): Promise<UpdateState | null> {
  if (!updatesSupported(options.platform)) return { kind: "unsupported" };

  const settings = options.settings();
  // The switch, unless the person is the one asking.
  if (!settings.autoUpdate && !manual) return { kind: "off" };
  // No feed — the setup is not finished, and the host is already putting
  // something in front of the person for a better reason than this one.
  if (settings.feedUrl === null) return { kind: "idle" };

  if (options.cookie !== undefined) {
    const cookie = await options.cookie.read();
    // Signed out. The shell's own guard is already saying so; an update
    // failure on top of it would be a second sentence about the same thing.
    if (cookie === null) return { kind: "idle" };
    options.updater.requestHeaders = { Cookie: cookie };
  }

  options.updater.setFeedURL({ provider: "generic", url: settings.feedUrl });
  return null;
}

/**
 * The updater's own events, turned into the states the window shows.
 *
 * `update-available` is reported as `downloading` rather than as a question,
 * because `autoDownload` is on: by the time anybody reads the window the
 * download is already running, and offering a choice that has been made is how
 * a dialog gets clicked through without being read.
 */
function listen(
  updater: UpdaterPort,
  move: (state: UpdateState) => void,
  current: () => UpdateState,
): void {
  updater.on("update-available", (info) =>
    move({ kind: "downloading", version: version(info), percent: null }),
  );
  updater.on("update-not-available", () => move({ kind: "none" }));
  updater.on("update-downloaded", (info) => move({ kind: "ready", version: version(info) }));
  updater.on("error", () => move({ kind: "failed" }));
  // The progress payload carries no version, so the state has to be rebuilt
  // from the one already held — see `progressed`.
  updater.on("download-progress", (info) => move(progressed(current(), info.percent)));
}

/**
 * Fold a `download-progress` payload into the state the window reads.
 *
 * Pure, and defensive on both counts that have teeth:
 *
 * 1. **A progress event outside a download is ignored.** `electron-updater`
 *    emits on its own schedule and an `error` or `update-downloaded` can land
 *    first; rebuilding a `downloading` state from one would put the window back
 *    into a download that has already finished or failed.
 * 2. **A percent that is not a usable number is ignored, not coerced.** `NaN`
 *    through a bar's `value` renders as empty, which reads as 0% — a download
 *    that appears to restart. Keeping the previous value is the honest answer.
 */
export function progressed(current: UpdateState, percent: unknown): UpdateState {
  if (current.kind !== "downloading") return current;
  if (typeof percent !== "number" || !Number.isFinite(percent)) return current;
  // The library reports 0-100 and has been seen to overshoot slightly on the
  // final chunk; a bar past its maximum draws as empty in Chromium.
  const clamped = Math.min(100, Math.max(0, percent));
  return { kind: "downloading", version: current.version, percent: clamped };
}

function version(info: { version?: string }): string {
  return typeof info.version === "string" ? info.version : "";
}
