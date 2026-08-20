/**
 * The manifest — what one package declares about itself, split by RUNTIME so
 * a bundle never pays for a half it cannot use.
 *
 * One module exporting the server factory next to the React factory would
 * drag Node into every SPA and React into every worker — the exact reason
 * today's packages split `./server` from `./react`. So the manifest is three
 * values behind three conventional subpaths:
 *
 *   `<pkg>/manifest`         the SHARED manifest — data every runtime can
 *                            hold: identity, permissions, notification
 *                            blueprints, MCP tools, the Prisma contribution,
 *                            e2e pointers, and the INVENTORY of the two
 *                            runtime manifests;
 *   `<pkg>/manifest/server`  the server capabilities (HTTP, jobs, email);
 *   `<pkg>/manifest/web`     the web capabilities (surface, areas).
 *
 * The inventory is what keeps the three honest across bundles: the shared
 * manifest NAMES every runtime capability, `defineServerManifest` /
 * `defineWebManifest` refuse a runtime manifest that drifts from it, and a
 * host that adopts the shared manifest without binding an inventoried
 * capability gets a red `assemble()` naming it. That is the mechanism that
 * turns "a version bump shipped a capability the host never wired" from a
 * silent 404 into a build failure.
 */

import type { EmailContribution } from "./email";
import type { HttpContribution } from "./http";
import type { JobsContribution } from "./jobs";
import type { McpContribution } from "./mcp";
import type { AnyNotificationBlueprint } from "./notifications";
import type { WirePermissionsContribution } from "./permissions";
import type { PrismaContribution } from "./db";
import type { AreaContribution, WebSurfaceContribution } from "./web";

/** Capabilities that live in the server manifest. */
export type ServerCapabilityKind = "http" | "jobs" | "email";

/** Capabilities that live in the web manifest. */
export type WebCapabilityKind = "surface" | "areas";

/** Capabilities the shared manifest carries as data. */
export type SharedCapabilityKind =
  | "permissions"
  | "notifications"
  | "mcp"
  | "db"
  | "e2e";

export type CapabilityKind =
  | ServerCapabilityKind
  | WebCapabilityKind
  | SharedCapabilityKind;

/** Where a package keeps its portable journeys (`./e2e` subpath today). */
export interface E2eContribution {
  /** The subpath exporting the features + steps (`@12-apps/<pkg>/e2e`). */
  readonly entry: string;
}

/**
 * The shared manifest: identity, the data capabilities, and the runtime
 * inventory. Everything here must be safe to import from ANY bundle.
 */
export interface PackageManifest {
  /** The package's published name (`@12-apps/report-builder`). */
  readonly name: string;
  /** The wiring-contract major this manifest speaks. */
  readonly contract: 1;
  readonly permissions?: WirePermissionsContribution;
  readonly notifications?: readonly AnyNotificationBlueprint[];
  readonly mcp?: McpContribution;
  readonly db?: PrismaContribution;
  readonly e2e?: E2eContribution;
  /** Inventory of the server manifest — must match its keys exactly. */
  readonly server?: readonly ServerCapabilityKind[];
  /** Inventory of the web manifest — must match its keys exactly. */
  readonly web?: readonly WebCapabilityKind[];
}

/**
 * The widest server manifest — the consumer's generic bound. Real manifests
 * are narrower (their config/deps/mailer types survive through the producer
 * factory's generic), and method bivariance is what lets them satisfy this.
 */
export interface AnyServerManifest {
  readonly name: string;
  readonly http?: HttpContribution<never, never>;
  readonly jobs?: JobsContribution<never>;
  readonly email?: EmailContribution<unknown>;
}

/** The widest web manifest — the consumer's generic bound. */
export interface AnyWebManifest {
  readonly name: string;
  readonly surface?: WebSurfaceContribution<never, unknown>;
  readonly areas?: readonly AreaContribution[];
}
