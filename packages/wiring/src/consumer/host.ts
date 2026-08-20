/**
 * The consumer half: adopt manifests, answer every declared capability, and
 * assemble the aggregate a host actually mounts.
 *
 * `adopt*` is where a host writes exactly what it writes today — the same
 * typed config objects — minus the shapes it can no longer get wrong:
 * ordering, conflict detection, memoisation, and the bookkeeping of what was
 * wired at all. `assemble()` is the gate: it refuses to answer while any
 * declared capability is neither bound nor declined, the same posture
 * `assertReportBuilderConfig` takes toward a host vocabulary — fail at the
 * call site, at boot, never quietly at a user's click.
 */

import { WiringAssemblyError } from "../errors";
import type { MountedRoute } from "../contract/http";
import type { BoundJob } from "../contract/jobs";
import type { WireMcpTool } from "../contract/mcp";
import type { AnyNotificationBlueprint } from "../contract/notifications";
import type { WirePermissionsContribution } from "../contract/permissions";
import type { PrismaContribution } from "../contract/db";
import type { AreaContribution } from "../contract/web";
import type { AnyServerManifest, AnyWebManifest, PackageManifest } from "../contract/manifest";
import type { WiringPorts } from "../ports";
import { bindEmail, bindHttp, bindJobs, bindSurface, type BindContext, type WiringSinks } from "./apply";
import { isDeclined, type MailerOf, type RuntimeBindings, type ServerBindings, type SurfaceOf, type WebBindings } from "./bindings";
import { findRouteConflicts, openApiMountPrefix, sortRoutes } from "./paths";
import { unboundEntries, type CapabilityReportEntry, type PackageReportEntry, type WiringReport } from "./report";

export type HostKind = "server" | "web";

export interface WiringHostOptions {
  /** The host's own name, prefixed on every assembly error. */
  name: string;
  kind: HostKind;
  ports?: WiringPorts;
}

/** One package handed to a server host: manifests plus the host's answers. */
export interface ServerAdoption<TManifest extends AnyServerManifest = AnyServerManifest> {
  manifest: PackageManifest;
  server?: TManifest;
  bindings?: ServerBindings<TManifest>;
  /**
   * Host-built, vocabulary-dependent MCP tools (the
   * `lifecycleMcpEndpoints(vocabulary)` pattern) — joined with the
   * manifest's own so the aggregate still uniqueness-checks every tool.
   * Absolute paths: the host authored them.
   */
  mcpEndpoints?: readonly WireMcpTool[];
  /**
   * Host specializations of the MANIFEST's tools, keyed by operationId and
   * shallow-merged — a narrowed schema (an enum of THIS host's preset keys),
   * a richer summary, a policy nudge. The escape valve that keeps a host from
   * forking the package's whole list to change one field; an unknown id is a
   * wiring error, so an override cannot silently outlive its tool.
   */
  mcpOverrides?: Readonly<Record<string, Partial<WireMcpTool>>>;
}

/** One package handed to a web host. */
export interface WebAdoption<TManifest extends AnyWebManifest = AnyWebManifest> {
  manifest: PackageManifest;
  web?: TManifest;
  bindings?: WebBindings<TManifest>;
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
  surfaces: Readonly<Record<string, unknown>>;
  permissions: readonly WirePermissionsContribution[];
  notifications: readonly AnyNotificationBlueprint[];
  mcpEndpoints: readonly WireMcpTool[];
  db: readonly PackageDbContribution[];
  areas: readonly PackageAreaContribution[];
  report: WiringReport;
}

export class WiringHost {
  private readonly options: WiringHostOptions;
  private readonly adopted = new Set<string>();
  private readonly entries: PackageReportEntry[] = [];
  private readonly sinks: WiringSinks = { routes: [], jobs: [], mailers: {}, surfaces: {} };
  private readonly permissions: WirePermissionsContribution[] = [];
  private readonly notifications: AnyNotificationBlueprint[] = [];
  private readonly mcpEndpoints: WireMcpTool[] = [];
  private readonly db: PackageDbContribution[] = [];
  private readonly areas: PackageAreaContribution[] = [];

  constructor(options: WiringHostOptions) {
    this.options = options;
  }

  adoptServer<TManifest extends AnyServerManifest = AnyServerManifest>(
    adoption: ServerAdoption<TManifest>,
  ): { mailer: MailerOf<TManifest> } {
    this.assertKind("server", adoption.manifest.name);
    const capabilities = this.beginAdoption(adoption.manifest);
    this.applyRuntime(adoption.manifest, {
      applicable: adoption.manifest.server ?? [],
      foreign: adoption.manifest.web ?? [],
      bindings: (adoption.bindings ?? {}) as RuntimeBindings,
      bind: (kind, context, binding) => this.bindServerKind(kind, context, adoption.server, binding),
      capabilities,
    });
    this.collectMcp(adoption.manifest, capabilities, {
      extra: adoption.mcpEndpoints,
      overrides: adoption.mcpOverrides,
      mountPath: this.httpMountPathOf(adoption.bindings as RuntimeBindings | undefined),
    });
    this.entries.push({ packageName: adoption.manifest.name, capabilities });
    return { mailer: this.sinks.mailers[adoption.manifest.name] as MailerOf<TManifest> };
  }

  adoptWeb<TManifest extends AnyWebManifest = AnyWebManifest>(
    adoption: WebAdoption<TManifest>,
  ): { surface: SurfaceOf<TManifest> } {
    this.assertKind("web", adoption.manifest.name);
    const capabilities = this.beginAdoption(adoption.manifest);
    this.collectMcp(adoption.manifest, capabilities, {});
    this.applyRuntime(adoption.manifest, {
      applicable: adoption.manifest.web ?? [],
      foreign: adoption.manifest.server ?? [],
      bindings: (adoption.bindings ?? {}) as RuntimeBindings,
      bind: (kind, context, binding) => this.bindWebKind(kind, context, adoption.web, binding),
      auto: (kind) => this.collectAreas(kind, adoption.manifest.name, adoption.web),
      capabilities,
    });
    this.entries.push({ packageName: adoption.manifest.name, capabilities });
    return { surface: this.sinks.surfaces[adoption.manifest.name] as SurfaceOf<TManifest> };
  }

  /** Refuse unbound capabilities and cross-package collisions; answer the rest. */
  assemble(): AssembledWiring {
    this.refuseUnbound();
    this.refuseRouteConflicts();
    this.refuseDuplicates("job wire name", this.sinks.jobs.map((job) => job.name));
    this.refuseDuplicates("MCP operationId", this.mcpEndpoints.map((tool) => tool.operationId));
    this.refuseDuplicates("permission id", this.permissions.flatMap((source) => source.ids));
    this.refuseDuplicates("notification type", this.notifications.map((blueprint) => blueprint.type));
    return {
      routes: sortRoutes(this.sinks.routes),
      jobs: [...this.sinks.jobs],
      mailers: { ...this.sinks.mailers },
      surfaces: { ...this.sinks.surfaces },
      permissions: [...this.permissions],
      notifications: [...this.notifications],
      mcpEndpoints: [...this.mcpEndpoints],
      db: [...this.db],
      areas: [...this.areas],
      report: { host: this.options.name, kind: this.options.kind, packages: [...this.entries] },
    };
  }

  private assertKind(expected: HostKind, packageName: string): void {
    if (this.options.kind !== expected) {
      throw new WiringAssemblyError(
        this.options.name,
        `${packageName}: this is a ${this.options.kind} host — use adopt${expected === "server" ? "Web" : "Server"} instead.`,
      );
    }
  }

  /** Duplicate-adoption check plus collection of the shared data capabilities. */
  private beginAdoption(manifest: PackageManifest): CapabilityReportEntry[] {
    if (this.adopted.has(manifest.name)) {
      throw new WiringAssemblyError(this.options.name, `${manifest.name} was adopted twice.`);
    }
    this.adopted.add(manifest.name);
    const capabilities: CapabilityReportEntry[] = [];
    if (manifest.permissions) {
      this.permissions.push(manifest.permissions);
      capabilities.push({ kind: "permissions", status: "collected", detail: `${manifest.permissions.ids.length} ids` });
    }
    if (manifest.notifications) {
      this.notifications.push(...manifest.notifications);
      capabilities.push({ kind: "notifications", status: "collected", detail: `${manifest.notifications.length} blueprints` });
    }
    if (manifest.db) {
      this.db.push({ packageName: manifest.name, contribution: manifest.db });
      capabilities.push({ kind: "db", status: "collected", detail: manifest.db.partial });
    }
    if (manifest.e2e) {
      capabilities.push({ kind: "e2e", status: "collected", detail: manifest.e2e.entry });
    }
    return capabilities;
  }

  /** The mount the http binding named, when http was bound rather than declined. */
  private httpMountPathOf(bindings: RuntimeBindings | undefined): string | undefined {
    const binding = bindings?.["http"];
    if (binding === undefined || isDeclined(binding)) return undefined;
    const mountPath = (binding as { mountPath?: unknown }).mountPath;
    return typeof mountPath === "string" ? mountPath : undefined;
  }

  /**
   * MCP tools, collected AFTER the bindings so the manifest's mount-relative
   * paths can be absolutized against the http binding's `mountPath` — one
   * source of truth for a tool's URL: the route descriptor it proxies to.
   * Host overrides are shallow-merged by operationId; host-built extras
   * (vocabulary factories) pass through untouched.
   */
  private collectMcp(
    manifest: PackageManifest,
    capabilities: CapabilityReportEntry[],
    input: {
      extra?: readonly WireMcpTool[];
      overrides?: Readonly<Record<string, Partial<WireMcpTool>>>;
      mountPath?: string;
    },
  ): void {
    const declared = manifest.mcp?.endpoints ?? [];
    const known = new Set(declared.map((tool) => tool.operationId));
    Object.keys(input.overrides ?? {}).forEach((operationId) => {
      if (!known.has(operationId)) {
        throw new WiringAssemblyError(
          this.options.name,
          `${manifest.name}: an MCP override targets "${operationId}", which the manifest does not declare.`,
        );
      }
    });
    const prefix = input.mountPath === undefined ? "" : openApiMountPrefix(input.mountPath);
    const fromManifest = declared.map((tool) => {
      const overridden = { ...tool, ...(input.overrides?.[tool.operationId] ?? {}) };
      return { ...overridden, path: `${prefix}${overridden.path}` };
    });
    const tools = [...fromManifest, ...(input.extra ?? [])];
    if (tools.length === 0) return;
    this.mcpEndpoints.push(...tools);
    capabilities.push({ kind: "mcp", status: "collected", detail: `${tools.length} tools` });
  }

  /** `areas` is data — collected without a binding, like the shared capabilities. */
  private collectAreas(
    kind: string,
    packageName: string,
    web: AnyWebManifest | undefined,
  ): CapabilityReportEntry | null {
    if (kind !== "areas") return null;
    const areas = web?.areas;
    if (!areas) {
      return { kind: "areas", status: "unbound", detail: "the web manifest carrying the areas was not provided" };
    }
    areas.forEach((area) => this.areas.push({ ...area, packageName }));
    return { kind: "areas", status: "collected", detail: `${areas.length} areas` };
  }

  /** The inventory × bindings walk both runtimes share. */
  private applyRuntime(
    manifest: PackageManifest,
    walk: {
      applicable: readonly string[];
      foreign: readonly string[];
      bindings: RuntimeBindings;
      bind: (kind: string, context: BindContext, binding: unknown) => CapabilityReportEntry;
      auto?: (kind: string) => CapabilityReportEntry | null;
      capabilities: CapabilityReportEntry[];
    },
  ): void {
    const context: BindContext = {
      hostName: this.options.name,
      packageName: manifest.name,
      sinks: this.sinks,
      hostEmailPort: this.options.ports?.email,
    };
    Object.keys(walk.bindings).forEach((key) => {
      if (!walk.applicable.includes(key)) {
        throw new WiringAssemblyError(
          this.options.name,
          `${manifest.name}: a binding answers "${key}", which the manifest does not declare.`,
        );
      }
    });
    walk.applicable.forEach((kind) => {
      const collected = walk.auto?.(kind);
      if (collected) {
        walk.capabilities.push(collected);
        return;
      }
      const binding = walk.bindings[kind];
      if (binding === undefined) {
        walk.capabilities.push({ kind: kind as CapabilityReportEntry["kind"], status: "unbound", detail: "declared by the manifest — bind it or decline it with a reason" });
        return;
      }
      if (isDeclined(binding)) {
        walk.capabilities.push({ kind: kind as CapabilityReportEntry["kind"], status: "declined", detail: binding.declined });
        return;
      }
      walk.capabilities.push(walk.bind(kind, context, binding));
    });
    walk.foreign.forEach((kind) => {
      walk.capabilities.push({
        kind: kind as CapabilityReportEntry["kind"],
        status: "out-of-scope",
        detail: `a ${this.options.kind === "server" ? "web" : "server"} host answers for this`,
      });
    });
  }

  private bindServerKind(
    kind: string,
    context: BindContext,
    server: AnyServerManifest | undefined,
    binding: unknown,
  ): CapabilityReportEntry {
    if (kind === "http") return bindHttp(context, server, binding);
    if (kind === "jobs") return bindJobs(context, server, binding);
    if (kind === "email") return bindEmail(context, server, binding);
    throw new WiringAssemblyError(this.options.name, `${context.packageName}: unknown server capability "${kind}".`);
  }

  private bindWebKind(
    kind: string,
    context: BindContext,
    web: AnyWebManifest | undefined,
    binding: unknown,
  ): CapabilityReportEntry {
    if (kind === "surface") return bindSurface(context, web, binding);
    throw new WiringAssemblyError(this.options.name, `${context.packageName}: unknown web capability "${kind}".`);
  }

  private refuseUnbound(): void {
    const unbound = unboundEntries(this.entries);
    if (unbound.length === 0) return;
    const list = unbound
      .map((entry) => {
        const why = entry.detail === undefined ? "" : ` (${entry.detail})`;
        return `${entry.packageName} → ${entry.kind}${why}`;
      })
      .join("; ");
    throw new WiringAssemblyError(this.options.name, `declared capabilities left unanswered: ${list}. Bind each one, or decline it with a written reason.`);
  }

  private refuseRouteConflicts(): void {
    const conflicts = findRouteConflicts(this.sinks.routes);
    if (conflicts.length === 0) return;
    const list = conflicts.map((conflict) => `${conflict.claim} (${conflict.packages.join(", ")})`).join("; ");
    throw new WiringAssemblyError(this.options.name, `route claims collide: ${list}.`);
  }

  private refuseDuplicates(what: string, values: readonly string[]): void {
    const seen = new Set<string>();
    const duplicated = values.filter((value) => {
      if (seen.has(value)) return true;
      seen.add(value);
      return false;
    });
    if (duplicated.length === 0) return;
    throw new WiringAssemblyError(this.options.name, `duplicate ${what}: ${[...new Set(duplicated)].join(", ")}.`);
  }
}

/** Build a host binder. One per process shape (API server, worker, one per SPA). */
export function createWiringHost(options: WiringHostOptions): WiringHost {
  return new WiringHost(options);
}
