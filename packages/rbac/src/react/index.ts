export {
  RbacProvider,
  useCan,
  useRbacPermissions,
  type RbacProviderProps,
} from './context';
export { Can, type CanProps } from './can';

// The packaged admin surface (12-13): Papéis + Equipe over the `/server`
// endpoints, on top of the provider above. Copy is REQUIRED host config; the
// origin host's sentences ship as the named `PT_BR_RBAC_WEB_COPY` pack.
export { createWebRbac, type RbacWebConfig, type WebRbac } from './create-web-rbac';
export type {
  MemberProfileCopy,
  PermissionLabelsCopy,
  RbacWebCopy,
  RoleFormCopy,
  RolesListCopy,
  RolesTableCopy,
  TeamRoleDialogCopy,
  TeamRowMenuCopy,
  TeamScreenCopy,
  TeamTableCopy,
} from './copy';
export { PT_BR_RBAC_WEB_COPY } from './pt-BR';
export { EN_US_RBAC_WEB_COPY } from './en-US';
export { RBAC_WEB_COPY } from './locales';
export {
  createRbacApiClient,
  type InviteResultWire,
  type MemberDetailWire,
  type PaginationWire,
  type RbacApiClient,
  type RoleListRowWire,
  type RoleWire,
  type TeamContextWire,
  type TeamMemberWire,
} from './api';
export { httpRbacTransport, type RbacResult, type RbacTransport } from './transport';
export {
  createRbacLabels,
  groupPermissions,
  sodCounterpart,
  type PermissionGroup,
  type RbacLabels,
} from './labels';
export { RoleForm, type RoleFormProps, type RoleFormValue } from './role-form';
export { splitRoleSelection } from './team-role-dialog';

// The screens themselves, for a host routing them rather than taking the
// package's tabs. Each is a plain component over the props `createWebRbac`
// already resolves — the factory is the convenience, not the only door.
export { RolesScreen, type RolesScreenProps } from './roles-screen';
export { TeamScreen, type TeamScreenProps } from './team-screen';
export { MemberScreen, type MemberScreenProps } from './member-screen';
export {
  MemberProfile,
  resolveProfileTab,
  type MemberProfileView,
  type ProfileTab,
} from './member-profile';

// The grid's row shapes and its URL⇄query mapping. A host composing its own
// list over the same endpoints reads the address bar the same way the packaged
// screen does, rather than restating the param names.
export {
  buildTeamRowActions,
  teamColumns,
  teamExportColumns,
  teamFields,
  teamQueryToParams,
  teamSearch,
  teamSyncState,
  type MemberRowStatus,
  type TeamRow,
  type TeamRowActionHandlers,
} from './team-grid-config';
export {
  permissionCount,
  roleColumns,
  roleFields,
  roleKindLabel,
  rolesQueryToParams,
  rolesSearch,
  rolesSyncState,
  toRoleRow,
  type RoleRow,
  type RoleSeedDefault,
} from './role-grid-config';
export { composeTeamRows, matchingInvites } from './use-team-data';
export { useRoleWrite, type RoleWrite } from './use-role-write';
export { useLatestRead, type LatestRead } from './use-latest-read';
export { type RoleMenuContext } from './role-actions-menu';
