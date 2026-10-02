/**
 * What a host hands `adopt*`: the manifests plus its answers, one shape per
 * host kind (see `./host`).
 */

import type { WireEnvValues } from "../contract/env";
import type { WireMcpTool } from "../contract/mcp";
import type { AnyNativeManifest, AnyServerManifest, AnyWebManifest, PackageManifest } from "../contract/manifest";
import type { DeclinedBinding, NativeBindings, ServerBindings, WebBindings } from "./bindings";

/**
 * The answers to the ANSWERABLE shared capabilities. Data capabilities
 * (permissions, notifications, mcp, db) are collected without asking; these
 * three each have a host-side half a package cannot supply:
 *
 * - `env`  — the host's actual environment (usually `process.env`). Required
 *   whenever the manifest declares variables for this host's runtime.
 * - `observability` — bound automatically from `ports.loggerFor`/`ports.logger`;
 *   this field only DECLINES it.
 * - `e2e`  — required whenever the manifest declares a WORLD: the
 *   `featuresRoot` its compiled journeys land under, or a written decline.
 *   This is the refusal that would have caught a shipped world going
 *   unadopted while its host re-derived the same journeys by hand.
 */
export interface SharedCapabilityAnswers {
  env?: WireEnvValues | DeclinedBinding;
  observability?: DeclinedBinding;
  e2e?: { featuresRoot: string } | DeclinedBinding;
}

/** One package handed to a server host: manifests plus the host's answers. */
export interface ServerAdoption<TManifest extends AnyServerManifest = AnyServerManifest>
  extends SharedCapabilityAnswers {
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
export interface WebAdoption<TManifest extends AnyWebManifest = AnyWebManifest>
  extends SharedCapabilityAnswers {
  manifest: PackageManifest;
  web?: TManifest;
  bindings?: WebBindings<TManifest>;
}

/**
 * One package handed to a NATIVE host (a React Native app). It answers the
 * native surface and nothing else: the server and web halves are other
 * hosts' business, reported out-of-scope here.
 */
export interface NativeAdoption<TManifest extends AnyNativeManifest = AnyNativeManifest>
  extends SharedCapabilityAnswers {
  manifest: PackageManifest;
  native?: TManifest;
  bindings?: NativeBindings<TManifest>;
}
