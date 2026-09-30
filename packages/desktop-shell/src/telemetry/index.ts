/**
 * `@12-apps/desktop-shell/telemetry` — knowing that the agent crashed, and
 * what it was doing.
 *
 * A tray program on a counter PC fails where nobody is looking. Without this a
 * crash leaves no trace at all: the agent dies with a menu open during a
 * download, comes back, and the only evidence is a download bar that has
 * started again from 4%. So the agent keeps three things:
 *
 * - a **session marker**, written at start and removed on a clean quit. A
 *   marker still on disk at the next start is a run that did not end cleanly —
 *   but so is every Windows shutdown and logoff, where Electron emits no
 *   `will-quit`. So a leftover marker is reported as a crash only when Crashpad
 *   wrote a dump during that run; without one it was the PC being switched off,
 *   which a counter does every night;
 * - **breadcrumbs**, the last few things it did (updater states, a menu
 *   opening, a window shown), saved into the marker at most once a second so a
 *   crash keeps the trail that led to it;
 * - a **queue** of reports, sent through whatever the host hands `flush` when
 *   it can, and kept on disk until then.
 *
 * Pure: the files, the clock and the timer are ports, so every rule here is a
 * test rather than something to find out at a counter. The Electron half —
 * the real files, Crashpad, the process's own ways of dying — is
 * `startCrashReporting` in `./electron`.
 *
 * The report texts are for the developer reading the ingest, never for the
 * person at the machine, which is why they are English and not a copy port.
 */

/** One step of what the agent was doing. */
interface Breadcrumb {
  at: string;
  text: string;
}

/** What a run leaves on disk while it is alive. */
export interface SessionMarker {
  version: string;
  startedAt: string;
  breadcrumbs: Breadcrumb[];
  /** The version this run restarted to install, when it did. */
  installing: string | null;
}

export type TelemetryKind = "crash" | "error" | "process-gone" | "install-failed";

/** One report, as the host's ingest receives it. */
export interface TelemetryReport {
  kind: TelemetryKind;
  /** The version the event happened in — for a crash, the crashed run's. */
  version: string;
  occurredAt: string;
  message: string;
  stack?: string;
  breadcrumbs?: Breadcrumb[];
  /** Anything else worth a column: process type, exit code, dump files. */
  details?: Record<string, string | number | boolean | null>;
}

/** The two files, as JSON. `null` is "not there". */
export interface TelemetryFiles {
  readMarker(): Promise<SessionMarker | null>;
  writeMarker(marker: SessionMarker): Promise<void>;
  /** Synchronous: it runs from `will-quit`, where nothing awaited finishes. */
  removeMarkerSync(): void;
  readQueue(): Promise<TelemetryReport[]>;
  writeQueue(queue: TelemetryReport[]): Promise<void>;
}

/** Last N breadcrumbs kept. Thirty is a minute of a busy download. */
export const BREADCRUMB_LIMIT = 30;
/** Reports kept while nothing can be sent; the oldest go first. */
export const QUEUE_LIMIT = 20;
/** How often, at most, breadcrumbs are written into the marker. */
const MARKER_WRITE_MS = 1000;

interface TelemetryOptions {
  files: TelemetryFiles;
  version: string;
  now?: () => Date;
  /** One-shot timer, swapped in tests. */
  later?: (run: () => void, ms: number) => void;
}

export interface Telemetry {
  /**
   * Open this run: report the last one if it crashed (or never became the
   * version it restarted to install), then write this run's marker.
   *
   * `listDumps` answers the crash dumps written since a moment — Crashpad's
   * files, for the report to name.
   */
  start(listDumps?: (since: Date) => Promise<string[]>): Promise<void>;
  breadcrumb(text: string): void;
  /** Queue a report. */
  report(report: Omit<TelemetryReport, "version" | "occurredAt"> & { version?: string }): void;
  /** Remember that this run is restarting to install `version`. */
  installing(version: string): Promise<void>;
  /**
   * Whether this run is the relaunch an update started — the previous run was
   * restarting to install exactly this version. Answered after `start`.
   */
  startedByUpdate(): boolean;
  /**
   * The version the previous run restarted to install and did not become —
   * never tried again automatically, or a failing installer would take the
   * agent down on every boot. Answered after `start`.
   */
  failedInstall(): string | null;
  /**
   * Send what is queued, oldest first. A refusal that will not change (a 4xx
   * other than 401/403/429, read from the rejection's `status`) drops that
   * report; any other failure stops and keeps the rest. One flush at a time: a
   * second call joins the first.
   */
  flush(send: (report: TelemetryReport) => Promise<void>): Promise<void>;
  /** A clean quit: the next start must not read this run as a crash. */
  end(): void;
}

export function createTelemetry(options: TelemetryOptions): Telemetry {
  const now = options.now ?? (() => new Date());
  const later = options.later ?? ((run, ms) => void setTimeout(run, ms));
  const marker: SessionMarker = {
    version: options.version,
    startedAt: now().toISOString(),
    breadcrumbs: [],
    installing: null,
  };
  const state = {
    queue: [] as TelemetryReport[],
    writePending: false,
    loaded: false,
    byUpdate: false,
    failedInstall: null as string | null,
    flushing: null as Promise<void> | null,
  };

  const persistQueue = (): Promise<void> => options.files.writeQueue(state.queue).catch(() => {});
  const persistMarker = (): Promise<void> => options.files.writeMarker(marker).catch(() => {});

  const enqueue = (report: TelemetryReport): void => {
    state.queue.push(report);
    if (state.queue.length > QUEUE_LIMIT) state.queue.splice(0, state.queue.length - QUEUE_LIMIT);
    void persistQueue();
  };

  return {
    async start(listDumps) {
      state.queue.push(...(await options.files.readQueue().catch(() => [])));
      const previous = await readPrevious(options, now(), listDumps);
      state.byUpdate = previous.byUpdate;
      state.failedInstall = previous.lost?.kind === "install-failed" ? previous.target : null;
      if (previous.lost !== null) enqueue(previous.lost);
      state.queue.splice(0, Math.max(0, state.queue.length - QUEUE_LIMIT));
      state.loaded = true;
      await persistMarker();
    },

    breadcrumb(text) {
      addCrumb(marker, now(), text);
      if (state.writePending || !state.loaded) return;
      state.writePending = true;
      later(() => {
        state.writePending = false;
        void persistMarker();
      }, MARKER_WRITE_MS);
    },

    report: (report) => enqueue(complete(report, options.version, now(), marker.breadcrumbs)),

    startedByUpdate: () => state.byUpdate,

    async installing(version) {
      marker.installing = version;
      await persistMarker();
    },

    failedInstall: () => state.failedInstall,

    flush: (send) => {
      state.flushing ??= flushQueue(state.queue, persistQueue, send).finally(() => {
        state.flushing = null;
      });
      return state.flushing;
    },

    end: () => endRun(marker, options.files),
  };
}

/** One step of the trail, capped, keeping only the last {@link BREADCRUMB_LIMIT}. */
function addCrumb(marker: SessionMarker, now: Date, text: string): void {
  marker.breadcrumbs.push({ at: now.toISOString(), text: clip(text, CAP.crumb) });
  marker.breadcrumbs.splice(0, Math.max(0, marker.breadcrumbs.length - BREADCRUMB_LIMIT));
}

/**
 * A clean quit removes the marker — except a quit to install: the next start
 * compares versions, and that comparison is the only way a silent installer
 * failure is ever seen.
 */
function endRun(marker: SessionMarker, files: TelemetryFiles): void {
  if (marker.installing !== null) return;
  try {
    files.removeMarkerSync();
  } catch {
    // Nothing to do about it on the way out.
  }
}

/** A report as it is queued: dated, versioned, with the trail, and no home paths. */
function complete(
  report: Parameters<Telemetry["report"]>[0],
  version: string,
  now: Date,
  breadcrumbs: Breadcrumb[],
): TelemetryReport {
  return {
    ...report,
    message: clip(withoutHome(report.message), CAP.message),
    ...(report.stack === undefined ? {} : { stack: clip(withoutHome(report.stack), CAP.stack) }),
    version: report.version ?? version,
    occurredAt: now.toISOString(),
    breadcrumbs: report.breadcrumbs ?? [...breadcrumbs],
  };
}

/** The previous run, as this one finds it: an update's relaunch, or a loss to report. */
async function readPrevious(
  options: TelemetryOptions,
  now: Date,
  listDumps: ((since: Date) => Promise<string[]>) | undefined,
): Promise<{ byUpdate: boolean; lost: TelemetryReport | null; target: string | null }> {
  const previous = await options.files.readMarker().catch(() => null);
  const byUpdate = installedAsPlanned(previous, options.version);
  if (previous === null || byUpdate) return { byUpdate, lost: null, target: null };
  const lost = await lostRun(previous, options.version, now, listDumps);
  return { byUpdate, lost, target: previous.installing };
}

/** Send oldest first; drop what will never be accepted, stop at anything else. */
async function flushQueue(
  queue: TelemetryReport[],
  persist: () => Promise<void>,
  send: (report: TelemetryReport) => Promise<void>,
): Promise<void> {
  for (;;) {
    const [next] = queue;
    if (next === undefined) return;
    try {
      await send(next);
    } catch (error) {
      // Kept for the next sign-in or start: a counter PC offline for an hour
      // is ordinary. But a report the ingest REFUSES as malformed will be
      // refused forever, and left at the head it would block every report
      // behind it — so that one is dropped.
      if (!refusedForGood(error)) return;
    }
    // By identity, not `shift()`: the cap in `enqueue` may have moved the head.
    const at = queue.indexOf(next);
    if (at >= 0) queue.splice(at, 1);
    await persist();
  }
}

function refusedForGood(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 && ![401, 403, 429].includes(status);
}

/**
 * Caps applied before anything is queued, so an ingest that validates the
 * same lengths never refuses a report for its size.
 */
const CAP = { message: 2000, stack: 8000, crumb: 300, detail: 500 } as const;

/** The dump names, within a detail's cap: the first few and how many in all. */
function dumpList(dumps: string[]): string | null {
  if (dumps.length === 0) return null;
  const shown = dumps.slice(0, 5).join(", ");
  return clip(dumps.length > 5 ? `${shown} (+${dumps.length - 5})` : shown, CAP.detail);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * What the previous run's marker says happened to it — or `null` for "nothing
 * worth a report".
 *
 * A marker left by a run that was restarting to install, when this run is NOT
 * the new version, is a failed install: the installer never ran, or ran and
 * gave up, and said nothing either way. Any other leftover marker is a crash
 * only when a dump from that run exists; see the header on why.
 */
async function lostRun(
  previous: SessionMarker,
  current: string,
  now: Date,
  listDumps: ((since: Date) => Promise<string[]>) | undefined,
): Promise<TelemetryReport | null> {
  const dumps =
    listDumps === undefined ? [] : await listDumps(new Date(previous.startedAt)).catch(() => []);
  const base = {
    version: previous.version,
    occurredAt: now.toISOString(),
    breadcrumbs: previous.breadcrumbs,
    details: { startedAt: previous.startedAt, dumps: dumpList(dumps) },
  };
  if (previous.installing !== null) {
    return {
      ...base,
      kind: "install-failed",
      message: `restarted to install ${previous.installing} but came back as ${current}`,
    };
  }
  if (dumps.length === 0) return null;
  return { ...base, kind: "crash", message: `the previous run (${previous.version}) crashed` };
}

/**
 * A user's own name out of a path: `C:\Users\ana\…` and `/home/ana/…` read
 * as `~` before anything leaves the machine.
 */
export function withoutHome(text: string): string {
  return text.replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, "~").replace(/\/(?:home|Users)\/[^/\s]+/g, "~");
}

/**
 * Whether the marker left behind is one this run should NOT report: the run was
 * restarting to install, and this run is the version it was installing.
 */
function installedAsPlanned(previous: SessionMarker | null, current: string): boolean {
  return previous !== null && previous.installing === current;
}
