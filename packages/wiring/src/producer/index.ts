/**
 * The producer half: how a PACKAGE declares its manifests.
 *
 * Three factories, one per manifest (see `../contract/manifest` for why the
 * split follows bundles), each an identity function plus assertions. The
 * doctrine is report-builder's: no defaults for anything a host must decide,
 * and every rule enforced at ASSEMBLY — a malformed manifest throws in the
 * package's own test run, before any host sees it.
 */

import { WiringDefinitionError } from "../errors";
import { isIsolatedDb } from "../contract/db";
import type { PrismaContribution } from "../contract/db";
import type {
  AnyServerManifest,
  AnyWebManifest,
  PackageManifest,
  ServerCapabilityKind,
  WebCapabilityKind,
} from "../contract/manifest";
import type { AnyNotificationBlueprint } from "../contract/notifications";
import type { McpContribution } from "../contract/mcp";
import type { WirePermissionsContribution } from "../contract/permissions";
import type { JobsContribution } from "../contract/jobs";
import type { AreaContribution } from "../contract/web";

function fail(name: string, message: string): never {
  throw new WiringDefinitionError(name === "" ? "<unnamed>" : name, message);
}

function assertUnique(name: string, what: string, values: readonly string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (value.trim() === "") fail(name, `${what} must not be blank.`);
    if (seen.has(value)) fail(name, `duplicate ${what}: "${value}".`);
    seen.add(value);
  }
}

function assertPermissions(name: string, contribution: WirePermissionsContribution): void {
  if (contribution.source.trim() === "") fail(name, "permissions.source must not be blank.");
  assertUnique(name, "permission id", contribution.ids);
  const declared = new Set(Object.keys(contribution.permissions));
  for (const id of contribution.ids) {
    if (!id.includes(":")) {
      fail(name, `permission id "${id}" has no domain segment (expected "domain:action").`);
    }
    if (!declared.delete(id)) fail(name, `permission id "${id}" is listed but has no spec.`);
  }
  const orphan = declared.values().next();
  if (!orphan.done) fail(name, `permission spec "${orphan.value}" is not listed in ids.`);
}

function assertNotifications(name: string, blueprints: readonly AnyNotificationBlueprint[]): void {
  assertUnique(name, "notification type", blueprints.map((blueprint) => blueprint.type));
  for (const blueprint of blueprints) {
    if (blueprint.category.trim() === "") {
      fail(name, `notification "${blueprint.type}" declares a blank category.`);
    }
  }
}

function assertMcp(name: string, mcp: McpContribution): void {
  assertUnique(name, "MCP operationId", mcp.endpoints.map((endpoint) => endpoint.operationId));
  for (const endpoint of mcp.endpoints) {
    if (!endpoint.path.startsWith("/")) {
      fail(name, `MCP endpoint "${endpoint.operationId}" path must start with "/".`);
    }
    if (endpoint.summary.trim() === "") {
      fail(name, `MCP endpoint "${endpoint.operationId}" needs a summary.`);
    }
  }
}

function assertIdentity(manifest: PackageManifest): void {
  if (manifest.name.trim() === "") fail(manifest.name, "manifest.name must not be blank.");
  if (manifest.contract !== 1) {
    fail(manifest.name, `unknown contract version ${String(manifest.contract)} (expected 1).`);
  }
}

/**
 * Postgres folds unquoted identifiers to lowercase and truncates at 63 bytes;
 * demanding that shape up front means the name in the manifest IS the name in
 * the database, with no quoting anywhere between.
 */
const PG_SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

function assertDb(name: string, db: PrismaContribution): void {
  if (isIsolatedDb(db)) {
    if (db.schema.trim() === "") fail(name, "db.schema must not be blank.");
    if (db.migrations.trim() === "") {
      fail(name, "an isolated db must name its migrations folder — deploy applies it.");
    }
    if (db.pgSchema === "public") {
      fail(name, 'db.pgSchema must not be "public" — that schema is the host\'s.');
    }
    if (!PG_SCHEMA_NAME.test(db.pgSchema)) {
      fail(name, `db.pgSchema "${db.pgSchema}" is not a plain lowercase Postgres identifier.`);
    }
  } else if (!db.partial.endsWith(".prisma")) {
    fail(name, `db.partial must point at a .prisma file, got "${db.partial}".`);
  }
}

/** Declare the shared manifest. Returns its argument, validated. */
export function defineManifest(manifest: PackageManifest): PackageManifest {
  assertIdentity(manifest);
  if (manifest.permissions) assertPermissions(manifest.name, manifest.permissions);
  if (manifest.notifications) assertNotifications(manifest.name, manifest.notifications);
  if (manifest.mcp) assertMcp(manifest.name, manifest.mcp);
  if (manifest.db) assertDb(manifest.name, manifest.db);
  if (manifest.server) assertUnique(manifest.name, "server inventory entry", manifest.server);
  if (manifest.web) assertUnique(manifest.name, "web inventory entry", manifest.web);
  return manifest;
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
export function assertDbMirror(
  manifest: PackageManifest,
  packageJson: { readonly name?: string; readonly wiring?: { readonly db?: unknown } },
): void {
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

/**
 * The inventory check both runtime factories share: the shared manifest's
 * list and the runtime manifest's actual keys must be the same set — in both
 * directions, so a capability cannot ship undeclared OR stay declared after
 * it is gone.
 */
function assertInventory(
  name: string,
  which: "server" | "web",
  listed: readonly string[],
  actual: readonly string[],
): void {
  for (const kind of actual) {
    if (!listed.includes(kind)) {
      fail(name, `${which} manifest declares "${kind}" but the shared inventory omits it.`);
    }
  }
  for (const kind of listed) {
    if (!actual.includes(kind)) {
      fail(name, `shared inventory lists "${kind}" but the ${which} manifest omits it.`);
    }
  }
}

function assertJobs(name: string, jobs: JobsContribution<never>): void {
  if (jobs.namespace.trim() === "") fail(name, "jobs.namespace must not be blank.");
  if (jobs.namespace.includes(".")) {
    fail(name, `jobs.namespace "${jobs.namespace}" must not contain dots — it is the prefix.`);
  }
  const names = Object.values(jobs.blueprints).map((blueprint) => blueprint.name);
  assertUnique(name, "job blueprint name", names);
  for (const blueprintName of names) {
    if (blueprintName.includes(".")) {
      fail(name, `job blueprint "${blueprintName}" must not contain dots — namespacing is the bind's job.`);
    }
  }
}

function serverKindsOf(server: AnyServerManifest): ServerCapabilityKind[] {
  const kinds: ServerCapabilityKind[] = [];
  if (server.http) kinds.push("http");
  if (server.jobs) kinds.push("jobs");
  if (server.email) kinds.push("email");
  return kinds;
}

/** Declare the server manifest against its shared half. */
export function defineServerManifest<TManifest extends AnyServerManifest>(
  shared: PackageManifest,
  server: TManifest,
): TManifest {
  if (server.name !== shared.name) {
    fail(shared.name, `server manifest is named "${server.name}" — the two must match.`);
  }
  assertInventory(shared.name, "server", shared.server ?? [], serverKindsOf(server));
  if (server.jobs) assertJobs(shared.name, server.jobs as JobsContribution<never>);
  return server;
}

function webKindsOf(web: AnyWebManifest): WebCapabilityKind[] {
  const kinds: WebCapabilityKind[] = [];
  if (web.surface) kinds.push("surface");
  if (web.areas) kinds.push("areas");
  return kinds;
}

function assertAreas(name: string, areas: readonly AreaContribution[]): void {
  assertUnique(name, "area", areas.map((area) => area.area));
  areas.forEach((area) => {
    const paths = (area.routes ?? []).map((route) => route.path);
    assertUnique(name, `route path in area "${area.area}"`, paths);
    const known = new Set(paths);
    (area.nav ?? []).forEach((nav) => {
      if (!known.has(nav.path)) {
        fail(name, `nav row "${nav.testId}" points at undeclared route "${nav.path}".`);
      }
    });
  });
}

/** Declare the web manifest against its shared half. */
export function defineWebManifest<TManifest extends AnyWebManifest>(
  shared: PackageManifest,
  web: TManifest,
): TManifest {
  if (web.name !== shared.name) {
    fail(shared.name, `web manifest is named "${web.name}" — the two must match.`);
  }
  assertInventory(shared.name, "web", shared.web ?? [], webKindsOf(web));
  if (web.areas) assertAreas(shared.name, web.areas);
  return web;
}
