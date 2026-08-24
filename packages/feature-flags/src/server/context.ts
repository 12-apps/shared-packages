/**
 * The server surface's vocabulary: the actor, the host seams, and the
 * wire-route twins.
 *
 * The request/response/route shapes are RESTATED here rather than imported
 * from `@12-apps/wiring` — the same structural-twin move `WireRoute`'s own
 * docstring blesses — so the contract package stays a type-only
 * devDependency and this package's release never waits on it. The manifest
 * compliance suite pins that the twins still satisfy the contract.
 */

import {
  assertCatalog,
  FeatureFlagsError,
  type FeatureFlagsDb,
  type FlagDefinition,
} from "../index";
import { missingServerCopy, resolveServerCopy } from "./copy";
import type { FeatureFlagsCopySource, FeatureFlagsServerCopy } from "./copy";

/**
 * Whoever the host resolved. Authorization is the HOST's, done before a
 * request ever reaches a descriptor (in the origin host: `requireSuperadmin`,
 * the env-allowlist platform authority) — the actor here is only the audit
 * identity a write is stamped with. A superadmin may have no users row at
 * all, so this is an email, never a user id.
 */
export interface FeatureFlagsActor {
  readonly email: string;
}

export interface DirectoryUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

/**
 * How grant rows become people. The grants table carries by-value user ids
 * with no FK, and this package is portable — so resolving ids to emails is
 * the host's, exactly like entity-lifecycle's `directory` seam. An id the
 * host no longer knows simply resolves to nothing; the view shows it with a
 * `null` email rather than hiding the grant.
 */
export interface FeatureFlagsDirectory {
  getUsers(ids: readonly string[]): Promise<readonly DirectoryUser[]>;
  findUserByEmail(email: string): Promise<DirectoryUser | null>;
}

export interface FeatureFlagsAuditEvent {
  readonly action: "granted" | "updated" | "revoked";
  readonly flagKey: string;
  readonly userId: string;
  /** The superadmin's email, from the actor. */
  readonly actor: string;
}

/** All REQUIRED, none defaulted — the report-builder doctrine. */
export interface FeatureFlagsServerConfig {
  /** The host's Prisma client, lazily (the lifecycle-mount convention). */
  db: () => Promise<FeatureFlagsDb>;
  /** The host's flag catalog. `[]` is valid: "no beta running". */
  catalog: readonly FlagDefinition[];
  directory: FeatureFlagsDirectory;
  /**
   * Every human-readable sentence the API answers with — host vocabulary, no
   * defaults.
   *
   * A host serving more than one language passes a RESOLVER instead of the
   * words — the shape `@12-apps/i18n`'s `localeCopy(PACK)` returns — and the
   * sentence is then chosen per request from {@link FeatureFlagsRequest.locale}.
   * Passing a plain value is unchanged in every respect, which is what keeps a
   * single-audience host from paying for a choice it never makes.
   */
  copy: FeatureFlagsCopySource<FeatureFlagsServerCopy>;
  /** Optional sink for the host's audit trail; awaited when it returns one. */
  audit?: (event: FeatureFlagsAuditEvent) => void | Promise<void>;
}

// ─── WireRoute twins ─────────────────────────────────────────────────────────

export interface FeatureFlagsRequest {
  actor: FeatureFlagsActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
  /**
   * The language to answer this caller in, as a BCP-47 tag — the same field
   * `@12-apps/wiring`'s `WireRequest` carries.
   *
   * Populated by the host's adapter, which is the only layer that can negotiate
   * one. Absent is meaningful and not an error: a host with one audience never
   * sets it, and this package must then answer with the words it was configured
   * with rather than invent a language.
   */
  locale?: string;
}

export interface FeatureFlagsResponse {
  status: number;
  /** `undefined` means NO body at all (204), which is not the same as `null`. */
  body: unknown;
}

export interface FeatureFlagsRoute {
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Relative to the host's mount, in `:param` form. */
  path: string;
  handle(request: FeatureFlagsRequest): Promise<FeatureFlagsResponse>;
}

/** Throws {@link FeatureFlagsError} at assembly, where the call site is. */
export function assertFeatureFlagsConfig(config: FeatureFlagsServerConfig): void {
  if (typeof config.db !== "function") {
    throw new FeatureFlagsError("invalid_config", "db must be a function returning the client.");
  }
  assertCatalog(config.catalog);
  if (typeof config.directory?.getUsers !== "function") {
    throw new FeatureFlagsError("invalid_config", "directory.getUsers is required.");
  }
  if (typeof config.directory.findUserByEmail !== "function") {
    throw new FeatureFlagsError("invalid_config", "directory.findUserByEmail is required.");
  }
  // Validated against the DEFAULT rendering — a resolver called with no
  // locale. A host that forgot a sentence still fails when it ASSEMBLES its
  // surface, exactly as before, rather than at whichever request first needs
  // the missing one. That is the property a resolver could most easily cost.
  const missing = missingServerCopy(resolveServerCopy(config.copy, undefined));
  if (missing.length > 0) {
    throw new FeatureFlagsError(
      "invalid_config",
      `copy is required, with every key non-blank — missing: ${missing.join(", ")}. ` +
        "Copy is host vocabulary; a pt-BR host passes PT_BR_FEATURE_FLAGS_SERVER_COPY by hand.",
    );
  }
}
