/**
 * The capability binders — one pure function per bindable capability, each
 * taking the manifest's contribution and the host's binding and writing into
 * the host's sinks. Kept out of the host class so each stays a small,
 * separately testable unit and the class stays orchestration.
 */

import { WiringAssemblyError } from "../errors";
import type { MountedRoute, WireRoute } from "../contract/http";
import type { BoundJob, JobsContribution, WireJobBlueprint } from "../contract/jobs";
import type { AnyServerManifest, AnyWebManifest } from "../contract/manifest";
import type { EmailPort } from "../contract/email";
import type { CapabilityReportEntry } from "./report";
import type { EmailBindingValue, HttpBindingValue, JobsBindingValue, SurfaceBindingValue } from "./bindings";

/** What the binders write into — the host's mutable aggregates. */
export interface WiringSinks {
  routes: MountedRoute[];
  jobs: BoundJob[];
  mailers: Record<string, unknown>;
  surfaces: Record<string, unknown>;
}

export interface BindContext {
  hostName: string;
  packageName: string;
  sinks: WiringSinks;
  hostEmailPort?: EmailPort;
}

function refuse(context: BindContext, message: string): never {
  throw new WiringAssemblyError(context.hostName, `${context.packageName}: ${message}`);
}

export function bindHttp(
  context: BindContext,
  server: AnyServerManifest | undefined,
  binding: unknown,
): CapabilityReportEntry {
  const contribution = server?.http;
  if (!contribution) refuse(context, 'a binding answers "http" but the server manifest declares none.');
  const value = binding as HttpBindingValue<never>;
  if (typeof value.mountPath !== "string" || value.mountPath === "") {
    refuse(context, 'the "http" binding needs a non-empty mountPath.');
  }
  const { routes } = contribution.create(value.config);
  routes.forEach((route) => {
    context.sinks.routes.push({
      packageName: context.packageName,
      mountPath: value.mountPath,
      route: route as WireRoute<never>,
    });
  });
  return {
    kind: "http",
    status: "bound",
    detail: `${routes.length} routes at ${value.mountPath}`,
  };
}

export function bindJobs(
  context: BindContext,
  server: AnyServerManifest | undefined,
  binding: unknown,
): CapabilityReportEntry {
  const contribution = server?.jobs as JobsContribution<never> | undefined;
  if (!contribution) refuse(context, 'a binding answers "jobs" but the server manifest declares none.');
  const { deps } = binding as JobsBindingValue<never>;
  const bound = Object.values(contribution.blueprints).map(
    (blueprint: WireJobBlueprint<never, never>): BoundJob => ({
      name: `${contribution.namespace}.${blueprint.name}`,
      queue: blueprint.queue,
      attempts: blueprint.attempts,
      backoff: blueprint.backoff,
      schedule: blueprint.schedule,
      concurrency: blueprint.concurrency,
      handle: (payload, jobContext) => blueprint.handle(payload, deps, jobContext),
    }),
  );
  context.sinks.jobs.push(...bound);
  return {
    kind: "jobs",
    status: "bound",
    detail: bound.map((job) => job.name).join(", "),
  };
}

export function bindEmail(
  context: BindContext,
  server: AnyServerManifest | undefined,
  binding: unknown,
): CapabilityReportEntry {
  const contribution = server?.email;
  if (!contribution) refuse(context, 'a binding answers "email" but the server manifest declares none.');
  const value = binding as EmailBindingValue;
  const port = value.port ?? context.hostEmailPort;
  if (!port) {
    return {
      kind: "email",
      status: "unbound",
      detail: "the binding names no port and the host provides no email port",
    };
  }
  context.sinks.mailers[context.packageName] = contribution.createMailer(port);
  return { kind: "email", status: "bound", detail: "mailer built on the host's email port" };
}

export function bindSurface(
  context: BindContext,
  web: AnyWebManifest | undefined,
  binding: unknown,
): CapabilityReportEntry {
  const contribution = web?.surface;
  if (!contribution) refuse(context, 'a binding answers "surface" but the web manifest declares none.');
  const value = binding as SurfaceBindingValue<never>;
  // Built ONCE per adoption, which is the memoisation every hand wiring
  // carries as a comment today: `create` returns component TYPES, and a
  // rebuild per render unmounts the whole surface.
  context.sinks.surfaces[context.packageName] = contribution.create(value.config);
  return { kind: "surface", status: "bound", detail: "surface built once for this host" };
}
