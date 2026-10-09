import type { SessionMarker, TelemetryReport } from "./index";

/**
 * When a run that came back as the OLD version calls an install failed
 * (FUT-3309) — kept apart from the telemetry core, which only asks it.
 */

/**
 * How long after asking to install a run that came back as the OLD version
 * waits before calling the install failed (FUT-3309).
 *
 * On Windows the old binary can be started again a few seconds into the
 * hand-off and be closed by the installer, which then starts the new version
 * some twenty seconds later: measured in production, 0.1.297 reported
 * `install-failed` twenty seconds before 0.1.306 — the version it said never
 * arrived — started. A verdict given at the old run's start is that false
 * alarm; one given after this wait, with the old run still alive, is not.
 */
export const INSTALL_VERDICT_MS = 120_000;

/** The previous run, as this one finds it. */
export interface PreviousRun {
  /** This run is the relaunch an update started. */
  byUpdate: boolean;
  /** What to report about it, if anything. */
  lost: TelemetryReport | null;
  /** The version it restarted to install, when it did. */
  target: string | null;
  /** When that restart was asked for, when the marker says. */
  since: string | null;
  /** How long an install's verdict must still wait; 0 to give it now. */
  verdictInMs: number;
}

/** How much of {@link INSTALL_VERDICT_MS} is left since `since` — 0 for no `since`. */
export function verdictWait(since: string | null, now: Date): number {
  const asked = since === null ? Number.NaN : Date.parse(since);
  if (Number.isNaN(asked)) return 0;
  // Capped: a clock set back since the request must not stretch the wait.
  return Math.min(INSTALL_VERDICT_MS, Math.max(0, asked + INSTALL_VERDICT_MS - now.getTime()));
}

/**
 * Hold an install's verdict until {@link INSTALL_VERDICT_MS} after it was asked
 * for (FUT-3309). Meanwhile this run's marker still names the version being
 * installed, so if the installer closes this run and starts that version, the
 * new run reads the restart as planned and nothing is reported. `report` runs
 * only if this run is still waiting on that same install when the time is up.
 */
export function awaitVerdict(
  marker: SessionMarker,
  previous: PreviousRun,
  report: () => void,
  later: (run: () => void, ms: number) => void,
): void {
  marker.installing = previous.target;
  marker.installingSince = previous.since;
  later(() => {
    // Still waiting on THAT request — not on a later one for the same version.
    if (marker.installing !== previous.target || marker.installingSince !== previous.since) return;
    marker.installing = null;
    marker.installingSince = null;
    report();
  }, previous.verdictInMs);
}
