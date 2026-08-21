/**
 * The package.json mirrors — the producer checks that need the MANIFEST and
 * the PACKAGE.JSON side by side, split from `index.ts` to keep each file
 * under the complexity gate's roof (the consumer's answers/mcp split, one
 * half over). Same doctrine throughout: run in the package's own test
 * suite, both directions, so neither side can drift silently.
 */

import { WiringDefinitionError } from "../errors";
import type { PackageManifest } from "../contract/manifest";

function fail(name: string, message: string): never {
  throw new WiringDefinitionError(name === "" ? "<unnamed>" : name, message);
}

/**
 * Host-side assemblers are plain Node reading `node_modules` — they cannot
 * execute this manifest. The db contribution is therefore mirrored into the
 * package's `package.json` under `"wiring": { "db": ... }`, and this
 * assertion — run in the package's own test suite, like every producer
 * check — is what keeps the mirror and the manifest the same object shape.
 * Both directions: a manifest with no db capability must not advertise one
 * in `package.json` either.
 */
export interface MirrorPackageJson {
  readonly name?: string;
  readonly wiring?: { readonly db?: unknown; readonly env?: unknown };
  readonly exports?: Readonly<Record<string, unknown>>;
}

export function assertDbMirror(manifest: PackageManifest, packageJson: MirrorPackageJson): void {
  if (packageJson.name !== undefined && packageJson.name !== manifest.name) {
    fail(manifest.name, `package.json is named "${packageJson.name}" — the two must match.`);
  }
  const mirrored = packageJson.wiring?.db;
  if (manifest.db === undefined) {
    if (mirrored !== undefined) {
      fail(manifest.name, "package.json wiring.db is set but the manifest declares no db capability.");
    }
    return;
  }
  if (mirrored === undefined) {
    fail(manifest.name, 'the db contribution must be mirrored under package.json "wiring": { "db": ... }.');
  }
  if (stableJson(mirrored) !== stableJson(manifest.db)) {
    fail(
      manifest.name,
      `package.json wiring.db drifted from the manifest: ${stableJson(mirrored)} !== ${stableJson(manifest.db)}.`,
    );
  }
}

/**
 * The env twin of `assertDbMirror`: the declaration must be readable by
 * host tooling that cannot execute TypeScript, so it is mirrored under
 * `package.json` `"wiring": { "env": ... }` and pinned here, in the
 * package's own test run, in both directions.
 */
export function assertEnvMirror(manifest: PackageManifest, packageJson: MirrorPackageJson): void {
  if (packageJson.name !== undefined && packageJson.name !== manifest.name) {
    fail(manifest.name, `package.json is named "${packageJson.name}" — the two must match.`);
  }
  const mirrored = packageJson.wiring?.env;
  if (manifest.env === undefined) {
    if (mirrored !== undefined) {
      fail(manifest.name, "package.json wiring.env is set but the manifest declares no env capability.");
    }
    return;
  }
  if (mirrored === undefined) {
    fail(manifest.name, 'the env contribution must be mirrored under package.json "wiring": { "env": ... }.');
  }
  if (stableJson(mirrored) !== stableJson(manifest.env)) {
    fail(
      manifest.name,
      `package.json wiring.env drifted from the manifest: ${stableJson(mirrored)} !== ${stableJson(manifest.env)}.`,
    );
  }
}

/**
 * The completeness tripwire: package.json `exports` subpaths and manifest
 * declarations must agree, in BOTH directions — run in the package's own
 * test suite like the mirrors above.
 *
 * The failure it exists to end: a capability shipped as an exports subpath
 * the manifest never mentioned, so an adopting host (or agent) reading the
 * manifest could not see it and reimplemented it instead. The reverse
 * direction is the same bug a release later: a declaration whose subpath is
 * gone points adopters at a module that no longer resolves.
 *
 * Only the wiring-owned conventional subpaths are checked — `./manifest`,
 * `./manifest/server`, `./manifest/web`, and the e2e entry. A package's own
 * API subpaths (`./server`, `./react`, …) are its business.
 */
export function assertExportsMirror(manifest: PackageManifest, packageJson: MirrorPackageJson): void {
  if (packageJson.name !== undefined && packageJson.name !== manifest.name) {
    fail(manifest.name, `package.json is named "${packageJson.name}" — the two must match.`);
  }
  const exported = packageJson.exports;
  if (exported === undefined) {
    fail(manifest.name, "package.json declares no exports map — hosts resolve every manifest through it.");
  }
  if (!("./manifest" in exported)) {
    fail(manifest.name, 'package.json exports no "./manifest" subpath — the shared manifest is unreachable.');
  }
  assertRuntimeSubpath(manifest.name, "server", manifest.server !== undefined, exported);
  assertRuntimeSubpath(manifest.name, "web", manifest.web !== undefined, exported);
  assertE2eSubpath(manifest, exported);
}

function assertRuntimeSubpath(
  name: string,
  which: "server" | "web",
  declared: boolean,
  exported: Readonly<Record<string, unknown>>,
): void {
  const subpath = `./manifest/${which}`;
  if (declared && !(subpath in exported)) {
    fail(name, `the manifest declares a ${which} inventory but package.json exports no "${subpath}" subpath — hosts cannot reach the runtime manifest.`);
  }
  if (!declared && subpath in exported) {
    fail(name, `package.json exports "${subpath}" but the manifest declares no ${which} inventory — the subpath is invisible to adopters.`);
  }
}

function assertE2eSubpath(
  manifest: PackageManifest,
  exported: Readonly<Record<string, unknown>>,
): void {
  if (manifest.e2e === undefined) {
    if ("./e2e" in exported) {
      fail(manifest.name, 'package.json exports "./e2e" but the manifest declares no e2e capability — packaged journeys an adopter cannot discover.');
    }
    return;
  }
  const prefix = `${manifest.name}/`;
  if (!manifest.e2e.entry.startsWith(prefix)) {
    fail(manifest.name, `e2e.entry "${manifest.e2e.entry}" does not start with "${prefix}" — the entry must be this package's own subpath.`);
  }
  const subpath = `./${manifest.e2e.entry.slice(prefix.length)}`;
  if (!(subpath in exported)) {
    fail(manifest.name, `e2e.entry points at "${subpath}" but package.json does not export it — the declared journeys do not resolve.`);
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
