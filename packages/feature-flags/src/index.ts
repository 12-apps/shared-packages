/**
 * `@12-apps/feature-flags` — user-level feature flags (FUT-884).
 *
 * The per-USER axis the tenant machinery cannot express: a beta feature is
 * granted to individual people, not to stores. A flag is a VEIL, never a key
 * — it composes by AND over every tenant axis (plan entitlements, lifecycle,
 * the tenant's own settings, RBAC), so it can only narrow visibility. It must
 * never turn on a feature some tenant axis turns off: bypassing the plan
 * layer would make grants a second, unpriced plan system, and a user-global
 * grant is only safe to carry across stores BECAUSE the tenant axes still
 * gate each one.
 *
 * Grants live in the database; the CATALOG deliberately does not. A flag with
 * no code behind it does nothing — every flag ships with a deploy anyway — so
 * the catalog arrives as host config, the host's own vocabulary (the
 * report-builder doctrine: required, never defaulted). A grant row whose key
 * left the catalog is an ORPHAN: reported by the management surface, ignored
 * by the reader.
 *
 * The failure semantics are the OPPOSITE of the entitlements package's, on
 * purpose: an entitlement absent from a stale snapshot stays unlocked (a
 * client must never paywall a feature the tenant owns), while a flag that is
 * absent, stale or failed-to-load stays HIDDEN — failing open leaks
 * unreleased work to everyone.
 */

/** One flag the host's code currently gates on. */
export interface FlagDefinition {
  /** Stable kebab-case id — what grant rows reference and route guards check. */
  readonly key: string;
  /** Host copy (pt-BR in the origin host), shown wherever flags are managed. */
  readonly label: string;
  /** Host copy: what the beta is, for the person doing the granting. */
  readonly description?: string;
}

/** Every failure this package raises on a wiring mistake. */
export class FeatureFlagsError extends Error {
  constructor(
    readonly code: "invalid_config",
    message: string,
  ) {
    super(message);
    this.name = "FeatureFlagsError";
  }
}

const FLAG_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * `users` would shadow the management surface's own `/users/:userId` route in
 * any in-order dispatcher, so no flag may claim it.
 */
const RESERVED_KEYS = new Set(["users"]);

function invalid(message: string): never {
  throw new FeatureFlagsError("invalid_config", message);
}

/**
 * Validate a host catalog, or throw naming the entry that is wrong — at the
 * factory call, where the wiring is. An EMPTY catalog is a complete,
 * meaningful configuration: "no beta running right now".
 */
export function assertCatalog(catalog: readonly FlagDefinition[]): void {
  const seen = new Set<string>();
  for (const flag of catalog) {
    if (!FLAG_KEY.test(flag.key)) {
      invalid(`flag key "${flag.key}" is not kebab-case ([a-z0-9-]).`);
    }
    if (RESERVED_KEYS.has(flag.key)) {
      invalid(`flag key "${flag.key}" is reserved by the management surface's own routes.`);
    }
    if (seen.has(flag.key)) invalid(`duplicate flag key "${flag.key}".`);
    seen.add(flag.key);
    if (flag.label.trim() === "") invalid(`flag "${flag.key}" has a blank label.`);
  }
}

/**
 * One row of `user_feature_grants`. `userId` is a by-value scalar — no
 * foreign key into any host table (the payments-backend doctrine), so the
 * model works in every repo without schema coupling. NO row means the flag's
 * default (off); a row with `enabled: false` is an EXPLICIT opt-out that
 * survives a future default-on rollout.
 */
export interface UserFeatureGrantRow {
  readonly id: string;
  readonly userId: string;
  readonly flagKey: string;
  readonly enabled: boolean;
  /** The granting superadmin's email — the management surface's audit line. */
  readonly grantedBy: string;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The structural Prisma seam — the subset of the generated delegate this
 * package calls. Method bivariance lets the real client satisfy it after the
 * host's one `as unknown as` cast (the notifications-mount convention).
 */
export interface UserFeatureGrantDelegate {
  findMany(args: {
    where?: { userId?: string; flagKey?: string };
    orderBy?: { updatedAt: "desc" } | Array<{ updatedAt: "desc" } | { id: "asc" }>;
    skip?: number;
    take?: number;
  }): Promise<UserFeatureGrantRow[]>;
  findUnique(args: {
    where: { userId_flagKey: { userId: string; flagKey: string } };
  }): Promise<UserFeatureGrantRow | null>;
  upsert(args: {
    where: { userId_flagKey: { userId: string; flagKey: string } };
    create: {
      userId: string;
      flagKey: string;
      enabled: boolean;
      grantedBy: string;
      note: string | null;
    };
    update: { enabled?: boolean; grantedBy?: string; note?: string | null };
  }): Promise<UserFeatureGrantRow>;
  delete(args: {
    where: { userId_flagKey: { userId: string; flagKey: string } };
  }): Promise<UserFeatureGrantRow>;
  count(args: { where: { flagKey?: string; userId?: string } }): Promise<number>;
}

export interface FeatureFlagsDb {
  userFeatureGrant: UserFeatureGrantDelegate;
}

// ─── Wire views ──────────────────────────────────────────────────────────────
// Plain data both halves speak: the server routes answer these shapes and the
// react surface's api client returns them. They live in the core entry so
// neither bundle imports the other's.

/** One grant as the management surface shows it. */
export interface GrantView {
  readonly userId: string;
  /** `null` when the host directory no longer knows the id (deleted user). */
  readonly email: string | null;
  readonly name: string | null;
  readonly flagKey: string;
  readonly enabled: boolean;
  readonly note: string | null;
  readonly grantedBy: string;
  /** ISO timestamp — `Date` does not survive the wire. */
  readonly updatedAt: string;
}

/** One catalog flag with its grant tallies, in catalog order. */
export interface FlagSummary {
  readonly key: string;
  readonly label: string;
  readonly description: string | null;
  readonly grantCount: number;
  readonly enabledCount: number;
}

/** Grant rows whose key left the catalog — the burn-down list. */
export interface OrphanGrantSummary {
  readonly flagKey: string;
  readonly grantCount: number;
}

// ─── The reader — the enforcement half ───────────────────────────────────────

export interface FlagReaderConfig {
  /** The host's Prisma client, lazily — the lifecycle-mount convention. */
  db: () => Promise<FeatureFlagsDb>;
  /** The host's catalog. Grants for keys outside it are invisible here. */
  catalog: readonly FlagDefinition[];
}

/** What a host gate calls on every request. Fails CLOSED by construction. */
export interface FlagReader {
  /** The enabled catalog flags this user holds. Blank user ⇒ empty set. */
  flagsFor(userId: string): Promise<ReadonlySet<string>>;
  isEnabled(userId: string, key: string): Promise<boolean>;
}

export function createFlagReader(config: FlagReaderConfig): FlagReader {
  assertCatalog(config.catalog);
  const known = new Set(config.catalog.map((flag) => flag.key));

  async function flagsFor(userId: string): Promise<ReadonlySet<string>> {
    // A blank id can never hold a grant; skipping the query keeps "no user"
    // from ever reading as "user with the empty-string id".
    if (userId.trim() === "") return new Set();
    const db = await config.db();
    const rows = await db.userFeatureGrant.findMany({ where: { userId } });
    return new Set(
      rows.filter((row) => row.enabled && known.has(row.flagKey)).map((row) => row.flagKey),
    );
  }

  return {
    flagsFor,
    async isEnabled(userId, key) {
      return (await flagsFor(userId)).has(key);
    },
  };
}
