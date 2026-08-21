import type { DiscountsLogger } from "../logging";

/**
 * A {@link DiscountsLogger} that keeps its lines instead of printing them.
 *
 * Shared by the surface's own suites and by the manifest's, because the logger
 * is required config now: a test that passed `{} as never` would be asserting
 * against a surface no host can build.
 */
export interface RecordingLogger extends DiscountsLogger {
  readonly lines: { level: "info" | "warn" | "error"; message: string }[];
  /** Every message at one level, for a case that only cares about that half. */
  at(level: "info" | "warn" | "error"): string[];
}

export function recordingLogger(): RecordingLogger {
  const lines: { level: "info" | "warn" | "error"; message: string }[] = [];
  return {
    lines,
    at: (level) => lines.filter((line) => line.level === level).map((line) => line.message),
    info: (message) => void lines.push({ level: "info", message }),
    warn: (message) => void lines.push({ level: "warn", message }),
    error: (message) => void lines.push({ level: "error", message }),
  };
}
