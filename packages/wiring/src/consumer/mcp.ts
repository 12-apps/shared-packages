/**
 * MCP tool collection — pure over its inputs, like the binders in `./apply`
 * and the shared-capability judges in `./answers`.
 *
 * Tools are collected AFTER the bindings so the manifest's mount-relative
 * paths can be absolutized against the http binding's `mountPath` — one
 * source of truth for a tool's URL: the route descriptor it proxies to.
 * Host overrides are shallow-merged by operationId; host-built extras
 * (vocabulary factories) pass through untouched.
 */

import { WiringAssemblyError } from "../errors";
import type { WireMcpTool } from "../contract/mcp";
import type { PackageManifest } from "../contract/manifest";
import { isDeclined, type RuntimeBindings } from "./bindings";
import { openApiMountPrefix } from "./paths";

export interface CollectMcpInput {
  extra?: readonly WireMcpTool[];
  overrides?: Readonly<Record<string, Partial<WireMcpTool>>>;
  mountPath?: string;
}

/** The mount the http binding named, when http was bound rather than declined. */
export function httpMountPathOf(bindings: RuntimeBindings | undefined): string | undefined {
  const binding = bindings?.["http"];
  if (binding === undefined || isDeclined(binding)) return undefined;
  const mountPath = (binding as { mountPath?: unknown }).mountPath;
  return typeof mountPath === "string" ? mountPath : undefined;
}

/** The package's tools, override-merged and absolutized. Empty when it has none. */
export function collectMcpTools(
  hostName: string,
  manifest: PackageManifest,
  input: CollectMcpInput,
): WireMcpTool[] {
  const declared = manifest.mcp?.endpoints ?? [];
  const known = new Set(declared.map((tool) => tool.operationId));
  Object.keys(input.overrides ?? {}).forEach((operationId) => {
    if (!known.has(operationId)) {
      throw new WiringAssemblyError(
        hostName,
        `${manifest.name}: an MCP override targets "${operationId}", which the manifest does not declare.`,
      );
    }
  });
  const prefix = input.mountPath === undefined ? "" : openApiMountPrefix(input.mountPath);
  const fromManifest = declared.map((tool) => {
    const overridden = { ...tool, ...(input.overrides?.[tool.operationId] ?? {}) };
    return { ...overridden, path: `${prefix}${overridden.path}` };
  });
  return [...fromManifest, ...(input.extra ?? [])];
}
