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
 * Subpath exports:
 *   "@12-apps/rbac"        -> this barrel (core + governance + templates)
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

// Application role templates (data, not core). A second host supplies its own.
export {
  FUTURE_PAY_PERMISSIONS,
  DEFAULT_ROLE_TEMPLATES,
  CLIENT_CAPABILITIES,
  FUTURE_PAY_SOD_PAIRS,
  FUTURE_PAY_LEAF_ONLY_ROLES,
  FUTURE_PAY_PLATFORM_ONLY_ROLES,
  FUTURE_PAY_GOVERNANCE,
  type FuturePayPermission,
} from './templates';
export {
  futurePayTenantRoleSeeds,
  type TenantRoleSeed,
} from './tenant-role-seeds';
