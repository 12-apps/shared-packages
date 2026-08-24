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
export { splitRoleSelection } from './team-screen';
