/**
 * The three host runtimes and how each reports the others' capabilities.
 */

import type { PackageManifest } from "../contract/manifest";

/** One per process shape: an API server or worker, a web SPA, or a React Native app. */
export type HostKind = "server" | "web" | "native";

/** A capability another runtime's host answers, and which one. */
export interface ForeignCapability {
  kind: string;
  runtime: HostKind;
}

/** Every runtime inventory of a manifest except `own`, tagged with its runtime. */
export function foreignOf(manifest: PackageManifest, own: HostKind): ForeignCapability[] {
  const inventories: [HostKind, readonly string[]][] = [
    ["server", manifest.server ?? []],
    ["web", manifest.web ?? []],
    ["native", manifest.native ?? []],
  ];
  return inventories
    .filter(([runtime]) => runtime !== own)
    .flatMap(([runtime, kinds]) => kinds.map((kind) => ({ kind, runtime })));
}

/** The adopt method that answers for each host kind, for the wrong-host error. */
export const ADOPT_METHOD: Record<HostKind, string> = {
  server: "adoptServer",
  web: "adoptWeb",
  native: "adoptNative",
};
