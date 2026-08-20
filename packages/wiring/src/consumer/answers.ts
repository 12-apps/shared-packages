/**
 * The answerable shared capabilities — pure judges, one per capability,
 * called by the host during adoption. Kept out of the host class for the
 * same reason the binders are (`./apply`): each is a small, separately
 * testable unit, and the class stays orchestration.
 */

import { envScopesOf } from "../contract/env";
import type { WireEnvVar } from "../contract/env";
import type { E2eContribution } from "../contract/manifest";
import type { LoggerPort, WiringPorts } from "../ports";
import { isDeclined, type DeclinedBinding } from "./bindings";
import type { CapabilityReportEntry } from "./report";

type E2eAnswer = { featuresRoot: string } | DeclinedBinding | undefined;
type EnvAnswer =
  | Readonly<Record<string, string | undefined>>
  | DeclinedBinding
  | undefined;

/**
 * Without a declared world, e2e stays a collected pointer. WITH one, the
 * host must answer — because both silent failure modes are real: journeys
 * compiled under `node_modules` pass green with zero tests, and a shipped
 * world nobody adopts is re-derived by hand, undiscovered.
 */
export function answerE2e(e2e: E2eContribution, answer: E2eAnswer): CapabilityReportEntry {
  if (!e2e.world) {
    return { kind: "e2e", status: "collected", detail: e2e.entry };
  }
  if (answer === undefined) {
    return {
      kind: "e2e",
      status: "unbound",
      detail: `the entry ships world ${e2e.world.factory} — bind it with your featuresRoot, or decline it in writing`,
    };
  }
  if (isDeclined(answer)) {
    return { kind: "e2e", status: "declined", detail: answer.declined };
  }
  if (answer.featuresRoot.trim() === "") {
    return {
      kind: "e2e",
      status: "unbound",
      detail: `a blank featuresRoot compiles the journeys under node_modules, where the runner ignores them`,
    };
  }
  return {
    kind: "e2e",
    status: "bound",
    detail: `${e2e.world.factory} journeys compile under ${answer.featuresRoot}`,
  };
}

/** Names only in every detail — a `secret` var's VALUE never enters the report. */
export function answerEnv(
  hostKind: "server" | "web",
  vars: readonly WireEnvVar[],
  answer: EnvAnswer,
): CapabilityReportEntry {
  const scopes = envScopesOf(hostKind);
  const applicable = vars.filter((declared) => scopes.includes(declared.scope ?? "server"));
  if (applicable.length === 0) {
    return {
      kind: "env",
      status: "out-of-scope",
      detail: `no declared var reads in a ${hostKind} runtime`,
    };
  }
  if (answer === undefined) {
    return {
      kind: "env",
      status: "unbound",
      detail: `declares ${applicable.length} vars for this runtime — answer with the host environment, or decline`,
    };
  }
  if (isDeclined(answer)) {
    return { kind: "env", status: "declined", detail: answer.declined };
  }
  const unset = (declared: WireEnvVar) => {
    const value = answer[declared.name];
    return value === undefined || value === "";
  };
  const missing = applicable.filter((declared) => declared.required === true && unset(declared));
  if (missing.length > 0) {
    return {
      kind: "env",
      status: "unbound",
      detail: `required env unset: ${missing.map((declared) => declared.name).join(", ")}`,
    };
  }
  const set = applicable.filter((declared) => !unset(declared)).length;
  return { kind: "env", status: "bound", detail: `${set}/${applicable.length} vars set` };
}

/**
 * Observability binds off the host's ports rather than a per-adoption
 * value: `loggerFor` when the host has a namespaced factory, a prefixing
 * fallback over the plain shared logger otherwise. The answer input only
 * DECLINES it.
 */
export function answerObservability(
  namespace: string,
  answer: DeclinedBinding | undefined,
  ports: WiringPorts | undefined,
): { entry: CapabilityReportEntry; logger?: LoggerPort } {
  if (answer !== undefined) {
    return { entry: { kind: "observability", status: "declined", detail: answer.declined } };
  }
  const build =
    ports?.loggerFor ?? (ports?.logger === undefined ? undefined : prefixedLogger(ports.logger));
  if (build === undefined) {
    return {
      entry: {
        kind: "observability",
        status: "unbound",
        detail: `namespace "${namespace}" declared — provide ports.loggerFor (or ports.logger), or decline`,
      },
    };
  }
  return {
    entry: { kind: "observability", status: "bound", detail: `namespace "${namespace}"` },
    logger: build(namespace),
  };
}

/** The `ports.logger` fallback: one shared logger, namespace on every line. */
function prefixedLogger(logger: LoggerPort): (namespace: string) => LoggerPort {
  return (namespace) => ({
    info: (message, ...meta) => logger.info(`[${namespace}] ${message}`, ...meta),
    warn: (message, ...meta) => logger.warn(`[${namespace}] ${message}`, ...meta),
    error: (message, ...meta) => logger.error(`[${namespace}] ${message}`, ...meta),
  });
}
