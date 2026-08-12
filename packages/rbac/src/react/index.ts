export {
  RbacProvider,
  useCan,
  useRbacPermissions,
  type RbacProviderProps,
} from './context';
export { Can, type CanProps } from './can';

// The packaged admin surface (12-13): Papéis + Equipe over the `/server`
// endpoints, on top of the provider above.
export { createWebRbac, type RbacWebConfig, type WebRbac } from './create-web-rbac';
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
  type RbacLabelOverrides,
  type RbacLabels,
} from './labels';
export { RoleForm, type RoleFormProps, type RoleFormValue } from './role-form';
export { splitRoleSelection } from './team-screen';
