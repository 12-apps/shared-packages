/**
 * @12-apps/rbac — generic, portable, engine-agnostic authorization core.
 *
 * Two seams behind a swappable Policy Decision Point (AuthzAdapter):
 *   - can(...)              -> adapter.check   (POINT decision)
 *   - visibleResources(...) -> adapter.visible (LIST decision)
 *
 * The default adapter is the built-in SQL/in-process RBAC engine (roles-as-data
 * + scope parent-walk + class/instance permissions + ownership/assignment
 * entity gate + ABAC caveats). An OpenFGA adapter would implement the same
 * AuthzAdapter interface and slot in via `config.adapter`.
 *
 * The package ships NO application catalog. It declares the three permissions
 * guarding its own screens and endpoints ({@link RBAC_PERMISSIONS}) and nothing
 * else; a host composes those with every other owner's contribution — other
 * packages', its own domain's — through `composePermissions`, and passes the
 * result into `createApiRbac` / `createWebRbac`. Composition is an argument at
 * one call site in the host: no global registry, and no import from here to a
 * sibling package.
 *
 * Subpath exports:
 *   "@12-apps/rbac"        -> this barrel (core + composition + governance)
 *   "@12-apps/rbac/react"  -> React provider + hooks/components
 *   "@12-apps/rbac/next"   -> framework-neutral server guards
 */
export type {
  PermissionString,
  PermissionKind,
  Actor,
  Scope,
  RoleAssignment,
  RoleDef,
  RolePermissionEntry,
  Caveat,
  AuthzContext,
  PermissionRegistry,
  AssignmentResolver,
  OwnershipPredicate,
  VisibleResult,
  AuthzAdapter,
  RbacConfig,
} from './core/types';

export { definePermissions } from './core/registry';

// Permission CONTRIBUTIONS — the unit each package hands its host, and the
// composition the host performs to assemble them into one typed catalog.
export {
  definePermissionContribution,
  mergeLabelVocabulary,
  type PermissionContribution,
  type PermissionLabelVocabulary,
  type PermissionOf,
  type PermissionSpec,
  type RbacLabelVocabulary,
} from './core/contribution';
export {
  composePermissions,
  RbacCatalogError,
  type ComposedPermissions,
  type RbacCatalog,
  type RbacCatalogErrorCode,
  type RbacRolePolicy,
} from './core/compose';

/** THIS package's own contribution — one input to the host's composition. */
export { RBAC_PERMISSIONS, type RbacPermission } from './permissions';

export {
  expandRole,
  buildRoleIndex,
  caveatsPass,
  WILDCARD,
  type ExpandedRole,
  type CaveatEntry,
  type Wildcard,
} from './core/roles';

export {
  canWith,
  permissionsFor,
  type CanContext,
} from './core/can';

export {
  createDefaultAdapter,
  resourceTypeOf,
  type DefaultAdapterDeps,
} from './core/adapter';

export {
  createRbac,
  type Rbac,
  type CheckContext,
} from './core/engine';

export { PermissionDeniedError } from './core/errors';

// Reusable ABAC caveat factories + the temporal assignment predicate.
export {
  amountAtMost,
  contextFlag,
  withinShift,
  notExpired,
  allOf,
  isActiveAssignment,
  type InstantLike,
  type TemporalAssignment,
} from './core/caveats';

// Governance validator (pure, framework-free).
export {
  validateGrant,
  type GovernanceCatalog,
  type SodPair,
  type ValidateGrantInput,
  type ValidateGrantResult,
} from './governance';

// The per-tenant seed ROW shape. The projection itself is reached through
// `catalog.tenantRoleSeeds` — bound to the host's role policy, so it cannot be
// called against a different role matrix than the one the engine resolves.
export type { TenantRoleSeed } from './tenant-role-seeds';
