/**
 * The aggregate `assemble()` answers — pure types, split from `host.ts` to
 * keep the class under the complexity gate's roof (the answers/mcp/mirrors
 * precedent).
 */

import type { MountedRoute } from "../contract/http";
import type { BoundJob } from "../contract/jobs";
import type { WireMcpTool } from "../contract/mcp";
import type { AnyNotificationBlueprint } from "../contract/notifications";
import type { WirePermissionsContribution } from "../contract/permissions";
import type { PrismaContribution } from "../contract/db";
import type { WireEnvVar } from "../contract/env";
import type { AreaContribution } from "../contract/web";
import type { LoggerPort } from "../ports";
import type { WiringReport } from "./report";

/** One package's declared env vars — assembled for deploy tooling to union. */
export interface PackageEnvContribution {
  packageName: string;
  vars: readonly WireEnvVar[];
}

export interface PackageDbContribution {
  packageName: string;
  contribution: PrismaContribution;
}

export interface PackageAreaContribution extends AreaContribution {
  packageName: string;
}

/** What `assemble()` answers — the aggregates plus the report. */
export interface AssembledWiring {
  /** Specificity-ordered, conflict-checked; register in this order. */
  routes: readonly MountedRoute[];
  /** `JobDefinition` twins — `jobs.map((job) => defineJob(job))` and done. */
  jobs: readonly BoundJob[];
  mailers: Readonly<Record<string, unknown>>;
  /** Each package's FULL `http.create` result, cast by the host — see `WiringSinks.http`. */
  http: Readonly<Record<string, unknown>>;
  surfaces: Readonly<Record<string, unknown>>;
  permissions: readonly WirePermissionsContribution[];
  notifications: readonly AnyNotificationBlueprint[];
  mcpEndpoints: readonly WireMcpTool[];
  db: readonly PackageDbContribution[];
  /** Every adopted package's declared env vars — union it for deploy tooling. */
  env: readonly PackageEnvContribution[];
  /** Namespace-scoped loggers, keyed by package name — the observability half. */
  loggers: Readonly<Record<string, LoggerPort>>;
  areas: readonly PackageAreaContribution[];
  report: WiringReport;
}
