/**
 * `@12-apps/rbac/server` — the host-mounted backend surface (12-13): the role
 * CRUD / permission / team endpoints as framework-neutral descriptors, the
 * guard helpers, the grant governance, and the stores over the five models
 * the package owns (`prisma/rbac.prisma`).
 */
export { createApiRbac, type ApiRbac } from './create-api-rbac';

export {
  GLOBAL_SCOPE,
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
  type RbacCopyResolver,
  type RbacCopySource,
  type RbacMessages,
  type RbacPendingInvite,
  type RbacRequest,
  type RbacResponse,
  type RbacRoute,
  type RbacServerConfig,
  type RbacUserDirectory,
  type RbacUserIdentity,
} from './context';
export { PT_BR_RBAC_MESSAGES } from './pt-BR';
export { EN_US_RBAC_MESSAGES } from './en-US';
export { RBAC_MESSAGES } from './locales';

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

// The ceiling's OTHER half. `./guards` already consumes one — it intersects
// with it and forces `isSuper` off whenever it is present — but computing it
// was unreachable, so every host wrote the three-row table itself against this
// package's own `getTenantRolesByName`/`expandRole`/`WILDCARD`.
export {
  createImpersonationCeiling,
  outsideBoundedTenant,
  type CeilingImpersonation,
  type ImpersonationCeilingConfig,
} from './impersonation-ceiling';

// The tenant-ROLE axis, whose order is the escalation fix: the bound is checked
// before anything can grant, and the platform short-circuit is unreachable
// while impersonating. A host with two authority resolvers is how that came to
// be checked in one of them and not the other.
export {
  createTenantGuards,
  type TenantGrant,
  type TenantGrantOutcome,
  type TenantGuardActor,
  type TenantGuardsConfig,
} from './tenant-guards';

// The resolver BOTH axes sit on. A host that resolves authority in two places
// will eventually apply an impersonation to one of them.
export {
  attributionOf,
  createEffectiveActor,
  type ActorAttribution,
  type ActorImpersonation,
  type EffectiveActor,
  type EffectiveActorConfig,
  type ResolvedIdentity,
} from './effective-actor';

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
export type { MemberDetailPayload, MyPermissionsPayload } from './payloads';

/**
 * The team-invite notification: the blueprint factory a host words itself, the
 * event type, and the port shape that fires it. See `./notifications` for why
 * the copy is an argument and the twins are local.
 */
export {
  createTeamInvitedBlueprint,
  TEAM_INVITED_NOTIFICATION_TYPE,
  type RbacNotificationBlueprint,
  type RbacNotificationContent,
  type RbacNotificationContext,
  type RbacNotifyEvent,
  type RbacNotifyOutcome,
  type RbacNotifyPort,
  type RbacNotifyRecipient,
  type TeamInvitedCopy,
  type TeamInvitedPayload,
} from './notifications';
export { PT_BR_TEAM_INVITED_COPY } from './pt-BR';
export { EN_US_TEAM_INVITED_COPY } from './en-US';
export { TEAM_INVITED_COPY } from './locales';
