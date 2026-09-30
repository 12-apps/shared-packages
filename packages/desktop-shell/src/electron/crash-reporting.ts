import { appendFileSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { app, crashReporter } from "electron";

import { createTelemetry, type Telemetry, type TelemetryFiles } from "../telemetry";

/**
 * The Electron half of the crash reports: the files, Crashpad, and the
 * process's own ways of dying. Every rule is in `../telemetry`.
 */

/** The updater's log is capped, with one rotation: a support call needs the tail. */
const UPDATER_LOG_BYTES = 1_000_000;

/** How long a run started by an update waits for the old process to let go. */
const LOCK_WAIT_MS = 15_000;

function jsonFiles(directory: string): TelemetryFiles {
  const marker = join(directory, "session.json");
  const queue = join(directory, "telemetry-queue.json");
  const read = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch {
      return fallback;
    }
  };
  // Through a temporary file and a rename: a crash in the middle of a write
  // must not leave a torn marker that reads as "no marker", which would hide
  // the very crash it was written for.
  // Each write its own temporary name: two writes of one file in flight (a
  // breadcrumb tick and `installing()`) must not rename each other's half.
  let serial = 0;
  const write = async (path: string, value: unknown): Promise<void> => {
    await mkdir(directory, { recursive: true });
    serial += 1;
    const temporary = `${path}.${process.pid}.${serial}.tmp`;
    await writeFile(temporary, JSON.stringify(value), "utf8");
    await rename(temporary, path);
  };
  return {
    readMarker: () => read(marker, null),
    writeMarker: (value) => write(marker, value),
    removeMarkerSync: () => unlinkSync(marker),
    readQueue: () => read(queue, []),
    writeQueue: (value) => write(queue, value),
  };
}

/** Crashpad's dumps written since a moment, by file name. */
function dumpsSince(since: Date): Promise<string[]> {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".dmp") && statSync(path).mtime >= since) found.push(entry.name);
    }
  };
  try {
    walk(app.getPath("crashDumps"));
  } catch {
    // No dump directory yet: nothing has crashed natively on this machine.
  }
  return Promise.resolve(found);
}

export interface CrashReportingOptions {
  /** Where the marker and the queue live. Defaults to `userData`. */
  directory?: string;
  /** The version reports carry. Defaults to `app.getVersion()`. */
  version?: string;
}

/**
 * Start the reports. Call before `app.whenReady()` resolves, so Crashpad is
 * already watching when the first window opens.
 *
 * `started` resolves once this copy either owns the marker (and has queued
 * what the previous run left) or has found itself to be a second copy — in
 * which case nothing on disk was touched and the shell's own single-instance
 * handling takes over.
 */
export function startCrashReporting(options: CrashReportingOptions = {}): {
  telemetry: Telemetry;
  started: Promise<void>;
} {
  // Dumps stay on the machine: there is no dump server, and the report names
  // them so a support call knows to ask for the file.
  crashReporter.start({ uploadToServer: false });

  const version = options.version ?? app.getVersion();
  const files = jsonFiles(options.directory ?? app.getPath("userData"));
  const telemetry = createTelemetry({ files, version });
  const owner = { held: false };

  reportProcessDeaths(telemetry);
  // A clean quit is the only way to leave no marker behind — and only the
  // copy that OWNS the marker may remove it.
  app.on("will-quit", () => {
    if (owner.held) telemetry.end();
  });

  const started = (async () => {
    // The lock BEFORE the marker: a second launch (a double-click while the
    // agent runs) must not read the running copy's marker as a crash, nor
    // overwrite or delete it. An update's relaunch waits for the lock instead,
    // because the old process is still on its way out.
    const previous = await files.readMarker().catch(() => null);
    if (previous?.installing === version) await waitForTheLock();
    else if (!app.requestSingleInstanceLock()) return;
    owner.held = true;
    await telemetry.start(dumpsSince);
  })();
  return { telemetry, started };
}

/**
 * Every way the process tells us part of it died, as a report.
 *
 * With an `uncaughtException` listener Electron's own "A JavaScript error
 * occurred in the main process" box stands down; the process keeps running
 * either way — a tray agent doing its work is worth more than a dialog nobody
 * reads.
 */
function reportProcessDeaths(telemetry: Telemetry): void {
  process.on("uncaughtException", (error) =>
    telemetry.report({ kind: "error", message: error.message, stack: error.stack }),
  );
  process.on("unhandledRejection", (reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    telemetry.report({
      kind: "error",
      message: `unhandled rejection: ${error.message}`,
      stack: error.stack,
    });
  });
  app.on("render-process-gone", (_event, _contents, details) =>
    telemetry.report({
      kind: "process-gone",
      message: `a window's renderer is gone: ${details.reason}`,
      details: { process: "renderer", reason: details.reason, exitCode: details.exitCode },
    }),
  );
  app.on("child-process-gone", (_event, details) =>
    telemetry.report({
      kind: "process-gone",
      message: `the ${details.type} process is gone: ${details.reason}`,
      details: { process: details.type, reason: details.reason, exitCode: details.exitCode },
    }),
  );
}

/**
 * A relaunch after an AppImage update is spawned BEFORE the old process has
 * quit (electron-updater's `AppImageUpdater`), so it would find the single-
 * instance lock still held, take itself for a second copy and exit — leaving
 * no agent at all. A run started by an update waits for the lock first.
 *
 * Resolves when the lock is held or the wait is over, whichever is first.
 */
export async function waitForTheLock(timeoutMs = LOCK_WAIT_MS): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!app.requestSingleInstanceLock() && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The logger shape `electron-updater` takes as `autoUpdater.logger`. */
export interface UpdaterLogger {
  info: (message: unknown) => void;
  warn: (message: unknown) => void;
  error: (message: unknown) => void;
  debug: (message: unknown) => void;
}

/**
 * electron-updater's own log, into `userData/logs/updater.log`.
 *
 * An install that never happens otherwise says nothing anywhere; this is the
 * file a support call opens first. Synchronous appends: the lines that matter
 * most are the last ones before the program quits to install.
 */
export function updaterFileLogger(): UpdaterLogger {
  const directory = join(app.getPath("userData"), "logs");
  const path = join(directory, "updater.log");
  const line = (level: string) => (message: unknown) => {
    try {
      mkdirSync(directory, { recursive: true });
      if (statSafe(path) > UPDATER_LOG_BYTES) renameSync(path, `${path}.1`);
      appendFileSync(path, `${new Date().toISOString()} ${level} ${String(message)}\n`);
    } catch {
      // A log that cannot be written must not become the failure.
    }
  };
  return { info: line("info"), warn: line("warn"), error: line("error"), debug: () => undefined };
}

function statSafe(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
