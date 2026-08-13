/**
 * Governance validator — pure, framework-free.
 *
 * Answers ONE question: "may this granter create/assign this role at this
 * scope?" It is NOT an authorization check (that is the engine's job); it is the
 * guard rail on the ROLE-ADMINISTRATION surface (custom roles, delegated admin).
 *
 * Zero runtime dependencies, zero framework imports — takes plain data and a
 * catalog, returns a verdict.
 */
import type {
  PermissionKind,
  PermissionRegistry,
  RoleDef,
  RolePermissionEntry,
} from './core/types';

/** A mutually-exclusive permission pair (separation of duties). */
export type SodPair = readonly [string, string];

/**
 * Governance catalog: the policy knobs the validator enforces. Framework-free
 * data — a host assembles it once (see the Future Pay template config).
 */
export interface GovernanceCatalog {
  /** Permission registry (used for scope-kind of a permission). */
  permissions: Pick<PermissionRegistry<string>, 'list' | 'has' | 'kind'>;
  /** All role definitions, so the validator can inspect a role being granted. */
  roles: readonly RoleDef[];
  /** Role names that are never grantable via a custom role (e.g. OWNER). */
  ownerRoles: readonly string[];
  /** Permission markers that flag a role as owner-level and thus ungrantable. */
  ownerPermissions?: readonly string[];
  /** Role names that may only be assigned at a leaf scope, never org/parent. */
  leafOnlyRoles: readonly string[];
  /** Mutually-exclusive permission pairs; one role may not hold both. */
  sodPairs: readonly SodPair[];
}

/** Input to {@link validateGrant}. */
export interface ValidateGrantInput {
  /** Permissions the GRANTER effectively holds (their own ceiling). */
  granterPermissions: Iterable<string>;
  /**
   * The role being granted/created. Either a known role name (resolved against
   * the catalog) or an inline custom {@link RoleDef}.
   */
  roleBeingGranted: string | RoleDef;
  /** The scope the role would be assigned at. */
  targetScope: {
    /** Is this a leaf scope (one site), or an org/parent scope? */
    isLeaf: boolean;
  };
  catalog: GovernanceCatalog;
  /**
   * When true, `roleBeingGranted` is a CURATED catalog template being re-tuned
   * per-tenant (FUT-217 template override), NOT a freshly-composed custom role.
   * Treated like a named catalog role: the owner-marker and separation-of-duties
   * COMPOSITION guards are skipped — a template's owner-marker permissions and
   * duty pairs are intrinsic to the vetted catalog, and preserving them while
   * editing is not "composing" new power — while the ESCALATION and SCOPE-CEILING
   * guards STILL gate the edited permission set against the granter's own ceiling.
   * An OWNER/SUPERADMIN (`ownerRoles`) template stays non-overridable regardless.
   */
  curatedTemplate?: boolean;
}

/** The verdict. `reason` is a stable machine code plus a human message. */
export type ValidateGrantResult =
  | { ok: true }
  | { ok: false; reason: string };

function fail(reason: string): ValidateGrantResult {
  return { ok: false, reason };
}

/**
 * Add each permission entry's name into `perms`. Extracted from the inherit
 * walk so folding a role's own list and each parent's list is a single (non-
 * nested) loop at every call site.
 */
function addPermissionEntries(
  perms: Set<string>,
  entries: readonly RolePermissionEntry<string>[],
): void {
  for (const entry of entries) {
    perms.add(typeof entry === 'string' ? entry : entry.permission);
  }
}

/** Resolve the effective, wildcard-expanded permission list of a role def. */
function rolePermissions(
  role: RoleDef,
  catalog: GovernanceCatalog,
): { wildcard: boolean; perms: string[] } {
  if (role.permissions === '*') {
    return { wildcard: true, perms: [...catalog.permissions.list] };
  }
  const perms = new Set<string>();
  addPermissionEntries(perms, role.permissions);
  // Fold inherited roles (shallow; catalog roles are the source of truth).
  const byName = new Map(catalog.roles.map((r) => [r.name, r]));
  const seen = new Set<string>();
  const walk = (names: readonly string[] | undefined): boolean => {
    for (const n of names ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      const parent = byName.get(n);
      if (!parent) continue;
      if (parent.permissions === '*') return true;
      addPermissionEntries(perms, parent.permissions);
      if (walk(parent.inherits)) return true;
    }
    return false;
  };
  const wildcard = walk(role.inherits);
  if (wildcard) return { wildcard: true, perms: [...catalog.permissions.list] };
  return { wildcard: false, perms: [...perms] };
}

/**
 * Owner-marker guard for a CURATED role (a named catalog template, or a per-tenant
 * OVERRIDE of one). Its owner-marker permissions are legitimate ONLY to the extent
 * the vetted SEED template already holds them: an override may PRESERVE a template's
 * intrinsic markers (ADMIN keeps 'roles:manage') but must never INJECT one the seed
 * lacks — that would compose owner-level power the catalog never granted (e.g. adding
 * 'payouts:manage' to MANAGER). Escalation alone can't stop this: it only asks "does
 * the actor hold it?", not "did the seed?". For a named catalog role the seed IS the
 * role, so this is a no-op.
 */
function checkCuratedMarkers(
  role: RoleDef,
  wildcard: boolean,
  perms: readonly string[],
  catalog: GovernanceCatalog,
): ValidateGrantResult {
  const seed = catalog.roles.find((r) => r.name === role.name);
  const seedResolved = seed
    ? rolePermissions(seed, catalog)
    : { wildcard: false, perms: [] as string[] };
  if (wildcard && !seedResolved.wildcard) {
    return fail(
      `OWNER_PROTECTED: template override cannot widen "${role.name}" to a wildcard ('*') permission set`,
    );
  }
  const ownerPerms = new Set(catalog.ownerPermissions ?? []);
  const seedMarkers = new Set(seedResolved.perms.filter((p) => ownerPerms.has(p)));
  const injected = perms.find((p) => ownerPerms.has(p) && !seedMarkers.has(p));
  if (injected !== undefined) {
    return fail(
      `OWNER_PROTECTED: template override cannot add owner-marker permission "${injected}" absent from the "${role.name}" seed`,
    );
  }
  return { ok: true };
}

/**
 * 1. Owner-protection — an owner role, a wildcard role, or an owner-marker
 * permission is never grantable via a custom role.
 */
function checkOwnerProtected(
  role: RoleDef,
  wildcard: boolean,
  perms: readonly string[],
  catalog: GovernanceCatalog,
  isCurated: boolean,
): ValidateGrantResult {
  if (catalog.ownerRoles.includes(role.name)) {
    return fail(
      `OWNER_PROTECTED: role "${role.name}" is an owner role and cannot be granted via a custom role`,
    );
  }
  // A CURATED role (named catalog template or per-tenant override, FUT-217) is vetted:
  // its owner-protection comes from `ownerRoles` plus a SEED-relative marker diff — it
  // may PRESERVE a seed's intrinsic markers but not INJECT new ones (see
  // checkCuratedMarkers). The blanket wildcard / owner-marker guards below are for
  // INLINE custom roles only.
  if (isCurated) {
    return checkCuratedMarkers(role, wildcard, perms, catalog);
  }
  if (wildcard) {
    return fail(
      `OWNER_PROTECTED: a wildcard ('*') role cannot be granted via a custom role`,
    );
  }
  const ownerPerms = new Set(catalog.ownerPermissions ?? []);
  const marker = perms.find((p) => ownerPerms.has(p));
  if (marker !== undefined) {
    return fail(
      `OWNER_PROTECTED: role includes owner-marker permission "${marker}"`,
    );
  }
  return { ok: true };
}

/** 2. Escalation guard — the granter may only grant permissions they hold. */
function checkEscalation(
  granterPermissions: Iterable<string>,
  perms: readonly string[],
): ValidateGrantResult {
  const held = new Set(granterPermissions);
  if (held.has('*')) return { ok: true };
  const missing = perms.find((p) => !held.has(p));
  if (missing !== undefined) {
    return fail(
      `ESCALATION: granter does not hold "${missing}" and cannot grant it`,
    );
  }
  return { ok: true };
}

/**
 * 3. Scope-ceiling — leaf-only roles and instance permissions may only be
 * assigned at a leaf scope.
 */
function checkScopeCeiling(
  role: RoleDef,
  perms: readonly string[],
  targetScope: { isLeaf: boolean },
  catalog: GovernanceCatalog,
): ValidateGrantResult {
  if (targetScope.isLeaf) return { ok: true };
  if (catalog.leafOnlyRoles.includes(role.name)) {
    return fail(
      `SCOPE_CEILING: role "${role.name}" is leaf-only and cannot be assigned at an org/parent scope`,
    );
  }
  const instancePerm = perms.find(
    (p) => (catalog.permissions.kind(p) as PermissionKind) === 'instance',
  );
  if (instancePerm !== undefined) {
    return fail(
      `SCOPE_CEILING: instance permission "${instancePerm}" cannot be assigned at an org/parent scope`,
    );
  }
  return { ok: true };
}

/** 4. Separation of duties — no single role may hold both halves of a pair. */
function checkSoD(
  perms: readonly string[],
  catalog: GovernanceCatalog,
): ValidateGrantResult {
  const permSet = new Set(perms);
  const clash = catalog.sodPairs.find(([a, b]) => permSet.has(a) && permSet.has(b));
  if (clash) {
    return fail(
      `SEPARATION_OF_DUTIES: a single role may not hold both "${clash[0]}" and "${clash[1]}"`,
    );
  }
  return { ok: true };
}

/**
 * Validate that `granter` may grant `roleBeingGranted` at `targetScope`.
 * Enforces, in order:
 *
 * 1. Owner-protection — a named owner role (`ownerRoles`) is never grantable; the
 *    owner-marker-permission check additionally vets INLINE custom roles.
 * 2. Escalation guard — the granter may only grant permissions they hold.
 * 3. Scope-ceiling — leaf-only roles and instance permissions may only be
 *    assigned at a leaf scope.
 * 4. Separation of duties — a role-COMPOSITION guard applied to INLINE custom
 *    roles only; vetted named catalog templates (and curated template overrides)
 *    are exempt.
 *
 * The two composition guards (owner-marker, SoD) police custom/inline roles a
 * granter builds; named catalog templates — and per-tenant template overrides
 * flagged `curatedTemplate` (FUT-217) — are curated, so only `ownerRoles`,
 * escalation and scope-ceiling gate them.
 */
export function validateGrant(
  input: ValidateGrantInput,
): ValidateGrantResult {
  const { granterPermissions, roleBeingGranted, targetScope, catalog } = input;

  const isNamedCatalogRole = typeof roleBeingGranted === 'string';
  const role: RoleDef | undefined = isNamedCatalogRole
    ? catalog.roles.find((r) => r.name === roleBeingGranted)
    : roleBeingGranted;

  if (!role) {
    return fail(
      `UNKNOWN_ROLE: role "${String(roleBeingGranted)}" is not in the catalog`,
    );
  }

  // A named catalog role OR an inline role explicitly flagged as a curated template
  // override (FUT-217) is a vetted role, not a freshly-composed one: the
  // composition guards (wildcard/owner-marker, SoD) are skipped, but owner-role
  // protection, escalation and scope-ceiling still apply.
  const isCurated = isNamedCatalogRole || input.curatedTemplate === true;

  const { wildcard, perms } = rolePermissions(role, catalog);

  const owner = checkOwnerProtected(role, wildcard, perms, catalog, isCurated);
  if (!owner.ok) return owner;

  const escalation = checkEscalation(granterPermissions, perms);
  if (!escalation.ok) return escalation;

  const scope = checkScopeCeiling(role, perms, targetScope, catalog);
  if (!scope.ok) return scope;

  // SoD is a role-COMPOSITION guard (like the owner-marker check): it vets INLINE
  // custom roles so a granter can't bundle conflicting duties. A curated role — a
  // named catalog template, or a per-tenant override of one (FUT-217) — is exempt
  // (e.g. ADMIN legitimately holds both purchasing:write and purchasing:approve);
  // escalation still gates who may grant/edit it.
  return isCurated ? { ok: true } : checkSoD(perms, catalog);
}
