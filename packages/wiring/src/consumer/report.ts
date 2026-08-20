/**
 * The wiring report — every adopted package, every declared capability, and
 * what the host did about each one.
 *
 * The report is the artifact the whole contract exists to produce: today the
 * only record of "what did this host wire" is the wiring code itself, read
 * file by file. Here it is data, so a boot log can print it, a test can pin
 * it, and a reviewer can diff it when a bump adds a capability.
 */

import type { CapabilityKind } from "../contract/manifest";

/**
 * What happened to one declared capability:
 *
 * - `bound`        — the host supplied config/deps and the capability is live;
 * - `declined`     — the host refused it, with a written reason;
 * - `collected`    — a data capability (permissions, notifications, MCP, db,
 *                    e2e) gathered into the aggregate for the host to feed
 *                    its own composition points;
 * - `out-of-scope` — declared for the OTHER runtime (a web surface on a
 *                    server host); the sibling host answers for it;
 * - `unbound`      — declared, applicable, and unanswered. `assemble()`
 *                    refuses to return while any of these exist.
 */
export type CapabilityStatus =
  | "bound"
  | "declined"
  | "collected"
  | "out-of-scope"
  | "unbound";

export interface CapabilityReportEntry {
  kind: CapabilityKind;
  status: CapabilityStatus;
  /** What was bound ("11 routes at /api/…"), or the decline/unbound reason. */
  detail?: string;
}

export interface PackageReportEntry {
  packageName: string;
  capabilities: readonly CapabilityReportEntry[];
}

export interface WiringReport {
  host: string;
  kind: "server" | "web";
  packages: readonly PackageReportEntry[];
}

/** The unbound entries, flattened — what `assemble()` refuses over. */
export function unboundEntries(
  packages: readonly PackageReportEntry[],
): { packageName: string; kind: CapabilityKind; detail?: string }[] {
  return packages.flatMap((entry) =>
    entry.capabilities
      .filter((capability) => capability.status === "unbound")
      .map((capability) => ({
        packageName: entry.packageName,
        kind: capability.kind,
        detail: capability.detail,
      })),
  );
}

/** One line per capability, aligned enough for a boot log or a test snapshot. */
export function renderWiringReport(report: WiringReport): string {
  const header = `wiring: ${report.host} (${report.kind} host)`;
  const lines = report.packages.flatMap((entry) => [
    `  ${entry.packageName}`,
    ...entry.capabilities.map((capability) => {
      const detail = capability.detail === undefined ? "" : ` — ${capability.detail}`;
      return `    ${capability.kind}: ${capability.status}${detail}`;
    }),
  ]);
  return [header, ...lines].join("\n");
}
