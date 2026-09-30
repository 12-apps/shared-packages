import { z } from "zod";

/**
 * The host's half of `../telemetry`: receiving a desktop agent's crash report
 * and turning it into ONE log line.
 *
 * Three pieces, so the host keeps its own route, auth and logger:
 *
 * - {@link desktopReportSchema} — the body, every string capped and nothing
 *   free-form beyond a short list of scalar details, so a report cannot become
 *   a log flood. Hand it to the route's validator: a body it refuses is a 400
 *   and nothing is logged.
 * - {@link describeDesktopReport} — the report as a single string. A log
 *   transport that forwards only the MESSAGE (a Sentry transport usually does)
 *   would otherwise receive a title and nothing to act on.
 * - {@link createReportBudget} — reports kept per key (a tenant, a device) per
 *   hour, which caps what any holder of the route's permission can push into
 *   the log's quota.
 */

const text = (max: number): z.ZodString => z.string().max(max);

export const desktopReportSchema = z.object({
  kind: z.enum(["crash", "error", "process-gone", "install-failed"]),
  version: text(40),
  occurredAt: text(40),
  message: text(2000),
  stack: text(8000).optional(),
  breadcrumbs: z
    .array(z.object({ at: text(40), text: text(300) }))
    .max(30)
    .optional(),
  details: z
    .record(text(60), z.union([text(500), z.number(), z.boolean(), z.null()]))
    .refine((value) => Object.keys(value).length <= 20, "too many details")
    .optional(),
  platform: text(40).optional(),
  osRelease: text(80).optional(),
  electron: text(40).optional(),
});

export type DesktopReport = z.infer<typeof desktopReportSchema>;

export interface DescribeOptions {
  /** The first token of the line, naming the agent — `[my-agent]`. The host's. */
  label: string;
  /**
   * `key=value` pairs for the second line, before `at=` — who sent it, in the
   * host's terms (`{ account: "acme" }`).
   */
  fields?: Readonly<Record<string, string>>;
}

/**
 * The whole report as one string: a first line
 * `<label> <kind> in <version>: <message>`, then who and where, the details,
 * the breadcrumb trail and the stack.
 */
export function describeDesktopReport(report: DesktopReport, options: DescribeOptions): string {
  const machine = [report.platform, report.osRelease, report.electron && `electron ${report.electron}`]
    .filter(Boolean)
    .join(" · ");
  const who = Object.entries(options.fields ?? {})
    .map(([key, value]) => `${key}=${value} `)
    .join("");
  const details = Object.entries(report.details ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  const trail = (report.breadcrumbs ?? []).map((crumb) => `  ${crumb.at} ${crumb.text}`).join("\n");
  return [
    `${options.label} ${report.kind} in ${report.version}: ${report.message}`,
    `${who}at=${report.occurredAt}${machine ? ` machine=${machine}` : ""}`,
    details && `details: ${details}`,
    trail && `breadcrumbs:\n${trail}`,
    report.stack && `stack:\n${report.stack}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const HOUR_MS = 3_600_000;

export interface ReportBudget {
  /**
   * Spend one report for `key`: `true` to log it, `false` once the hour's
   * budget is gone. Over budget, a host should still answer the agent with a
   * success — a refusal only keeps the report in its queue to be sent again.
   */
  spend(key: string, now?: number): boolean;
  /** Forget every window. For tests. */
  reset(): void;
}

/**
 * A fixed hourly window per key, in this process's memory: a second instance
 * gets its own budget, which is fine for a cap on a log's quota.
 */
export function createReportBudget(options: { perHour: number }): ReportBudget {
  const windows = new Map<string, { windowStart: number; used: number }>();
  return {
    spend(key, now = Date.now()) {
      const entry = windows.get(key);
      if (entry === undefined || now - entry.windowStart >= HOUR_MS) {
        windows.set(key, { windowStart: now, used: 1 });
        return true;
      }
      if (entry.used >= options.perHour) return false;
      entry.used += 1;
      return true;
    },
    reset() {
      windows.clear();
    },
  };
}
