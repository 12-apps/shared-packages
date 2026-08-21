/**
 * Every sentence the roles + team admin renders — REQUIRED host config, with
 * NO defaults (the copy-portability doctrine): two screens, their tables,
 * dialogs and the row menu compiled in ~50 pt-BR strings a host could not
 * reach, so every adopter shipped one product's voice with nothing red. A
 * pt-BR host imports {@link PT_BR_RBAC_WEB_COPY} from `./pt-BR` (re-exported
 * at `@12-apps/rbac/react`) and passes it by hand — one reviewable line,
 * never a silence.
 *
 * Facts travel as ARGUMENTS (a role name, a member's name, a count), so a
 * translation can put them where its own grammar wants them.
 */

/**
 * The picker's words for THIS package's own permission segments. Every other
 * segment's words arrive with the contribution that owns the ids they label
 * (`catalog.labels`); these are the words for `roles:manage` / `team:read` /
 * `team:manage`, the three ids this package contributes — which is why they
 * live in the copy port rather than in the contribution, where they used to
 * be one application's pt-BR shipped to every adopter.
 */
export interface PermissionLabelsCopy {
  /** The picker's group headings for the two domains this package's ids live under. */
  domains: { roles: string; team: string };
  /** The verb segments those three ids use. */
  actions: { read: string; manage: string };
}

export interface RolesListCopy {
  title: string;
  newRoleAction: string;
  searchPlaceholder: string;
  loadFailed: string;
  /** The compose/edit dialog's title, per mode. */
  dialogTitles: {
    create: string;
    edit: (name: string) => string;
    override: (name: string) => string;
  };
  deleteConfirm: { title: string; body: string; confirmLabel: string };
  resetConfirm: { title: string; body: string; confirmLabel: string };
  /** The confirm step's back-out. */
  cancelAction: string;
}

export interface RolesTableCopy {
  headers: { name: string; description: string; kind: string; permissions: string; actions: string };
  /** The chip naming a row's kind. */
  kinds: { system: string; custom: string };
  /** The permission count of a wildcard (`'*'`) role. */
  allPermissions: string;
  editAction: string;
  resetAction: string;
  deleteAction: string;
}

export interface RoleFormCopy {
  /** The name field's placeholder AND accessible label. */
  nameLabel: string;
  descriptionPlaceholder: string;
  /** The description field's accessible label. */
  descriptionLabel: string;
  /** "Permissões (N selecionadas)" — the pack owns the pluralisation. */
  selectionCount: (count: number) => string;
  /** The per-permission scope-kind badge. */
  kinds: { class: string; instance: string };
  cancelAction: string;
  /** The submit when editing an existing role. */
  saveAction: string;
  /** The submit when composing a new one. */
  createAction: string;
}

export interface TeamScreenCopy {
  title: string;
  searchPlaceholder: string;
  loadFailed: string;
  removeConfirm: { title: string; body: string; confirmLabel: string };
  /** The confirm step's back-out. */
  cancelAction: string;
  pendingInvitesTitle: string;
  /** One pending accountless invite, from its e-mail and role label. */
  pendingInviteLine: (email: string, role: string) => string;
}

export interface TeamTableCopy {
  headers: { name: string; email: string; roles: string; status: string };
  status: { active: string; disabled: string };
}

export interface TeamRoleDialogCopy {
  title: (member: string) => string;
  /** The title while no member is loaded (the dialog's closed frame). */
  fallbackTitle: string;
  systemGroupTitle: string;
  customGroupTitle: string;
  /** The warning while the selection has zero or two system roles. */
  exactlyOneSystemRole: string;
  cancelAction: string;
  saveAction: string;
}

export interface TeamRowMenuCopy {
  editRoles: string;
  activate: string;
  deactivate: string;
  remove: string;
  /** The menu's fallback row for an actor who may change nothing. */
  noActions: string;
}

export interface RbacWebCopy {
  /** The wrapped transport's last-resort failure sentence. */
  operationFailed: string;
  /** While the caller's own permission set is being fetched. */
  loading: string;
  /** When that fetch fails — the surface renders nothing else. */
  permissionsLoadFailed: string;
  tabs: { roles: string; team: string };
  permissionLabels: PermissionLabelsCopy;
  rolesList: RolesListCopy;
  rolesTable: RolesTableCopy;
  roleForm: RoleFormCopy;
  teamScreen: TeamScreenCopy;
  teamTable: TeamTableCopy;
  teamRoleDialog: TeamRoleDialogCopy;
  teamRowMenu: TeamRowMenuCopy;
}
