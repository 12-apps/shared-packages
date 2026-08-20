/**
 * `@12-apps/rbac/server` — the host-mounted backend surface (12-13): the role
 * CRUD / permission / team endpoints as framework-neutral descriptors, the
 * guard helpers, the grant governance, and the stores over the five models
 * the package owns (`prisma/rbac.prisma`).
 */
export { createApiRbac, type ApiRbac } from './create-api-rbac';

export {
  GLOBAL_SCOPE,
  DEFAULT_MESSAGES,
  DEFAULT_GATE_PERMISSIONS,
  RbacApiError,
  ok,
  fail,
  foldApiError,
  paginationMeta,
  type PaginationMeta,
  type RbacActor,
  type RbacAuditEntry,
  type RbacAuditSink,
  type RbacGatePermissions,
  type RbacInvitesPort,
  type RbacMessages,
  type RbacPendingInvite,
  type RbacRequest,
  type RbacResponse,
  type RbacRoute,
  type RbacServerConfig,
  type RbacUserDirectory,
  type RbacUserIdentity,
} from './context';

export {
  isUniqueViolation,
  type MembershipDelegate,
  type MembershipOrderBy,
  type MembershipRoleDelegate,
  type MembershipRoleRow,
  type MembershipRoleWhere,
  type MembershipRow,
  type MembershipWhere,
  type RbacDb,
  type RbacDbClient,
  type RbacDbProvider,
  type ResourceAssignmentDelegate,
  type ResourceAssignmentWhere,
  type RoleAssignmentDelegate,
  type RoleAssignmentRow,
  type RoleAssignmentWhere,
  type RoleCreateData,
  type RoleDelegate,
  type RoleOrderBy,
  type RoleRow,
  type RoleUpdateData,
  type RoleWhere,
  ROLE_SELECT,
  MEMBERSHIP_SELECT,
  MEMBERSHIP_ROLE_SELECT,
  ROLE_ASSIGNMENT_SELECT,
} from './db';

export {
  createRbacGuards,
  intersectPermissions,
  type ListVisibilityForActor,
  type RbacGuardActor,
  type RbacGuards,
  type RbacPermissionOptions,
} from './guards';

export {
  andVisibleWhere,
  mergeVisibleResults,
  visibleResultToWhere,
  type ListVisibility,
  type VisibleWhere,
} from './visible';

export { createGrantGovernance, type GrantGovernance } from './grant-governance';

export {
  createRolesStore,
  type RoleListQuery,
  type RoleListRecord,
  type RoleRecord,
  type RolesStore,
  type RoleWriteInput,
} from './roles-store';
export { tenantRoleSeedRows } from './template-store';

export {
  createTeamStore,
  type TeamListQuery,
  type TeamMemberDetail,
  type TeamMemberRecord,
  type TeamStore,
} from './team-store';

// The roster's two ROLE-NAME questions. `RbacActorTier` is part of
// `TeamStore.removeTenantMemberGuarded`'s signature, so a host calling the
// store directly needs it; `ownerRolesOf` answers "which roles does this
// config protect" for a host wiring its own removal path beside the packaged
// one.
export { ownerRolesOf, type RbacActorTier } from './roster-policy';

export {
  getTenantRolesByName,
  isOrgScope,
  isTenantScope,
} from './engine';

export {
  parseRolePermissions,
  serializeRolePermissions,
  tenantRoleKey,
} from './permissions-format';

export {
  buildWireSchemas,
  parseRoleListQuery,
  parseTeamListQuery,
  type RoleWireSchemas,
} from './wire';
export type { MyPermissionsPayload } from './payloads';
