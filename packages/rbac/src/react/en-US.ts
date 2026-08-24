import type { RbacWebCopy } from './copy';

/**
 * The en-US pack — the same two screens for an English-reading audience. The
 * filename is what exempts this file from the copy-portability gate, as
 * `pt-BR.ts` beside it is exempt.
 *
 * Facts travel as ARGUMENTS (a role name, a member's name, a count), which is
 * what lets this translation put them where English grammar wants them —
 * `teamRoleDialog.title` reads "Roles for X" where the Portuguese reads
 * "Papéis de X", and neither had to be reshaped to fit the other.
 */
export const EN_US_RBAC_WEB_COPY: RbacWebCopy = {
  operationFailed: 'That action could not be completed.',
  loading: 'Loading…',
  permissionsLoadFailed: 'Could not load your permissions.',
  tabs: { roles: 'Roles', team: 'Team' },
  permissionLabels: {
    // The words for THIS package's own three permission ids. Every other
    // segment's words arrive with the contribution that owns the ids.
    domains: { roles: 'Roles', team: 'Team' },
    actions: { read: 'View', manage: 'Manage' },
  },
  rolesList: {
    title: 'Roles',
    newRoleAction: 'New role',
    searchPlaceholder: 'Search roles',
    loadFailed: 'Could not load the roles.',
    dialogTitles: {
      create: 'New role',
      edit: (name) => `Edit ${name}`,
      override: (name) => `Edit the system role ${name}`,
    },
    deleteConfirm: {
      title: 'Delete this role?',
      body: 'Anyone holding it loses its access immediately.',
      confirmLabel: 'Delete',
    },
    resetConfirm: {
      title: 'Restore this role to its default?',
      body: 'Its permissions return to the system default. This cannot be undone.',
      confirmLabel: 'Restore default',
    },
    cancelAction: 'Cancel',
  },
  rolesTable: {
    headers: {
      name: 'Name',
      description: 'Description',
      kind: 'Kind',
      permissions: 'Permissions',
      actions: 'Actions',
    },
    kinds: { system: 'System', custom: 'Custom' },
    // What a wildcard role's permission count reads as, in place of a number.
    allPermissions: 'all',
    editAction: 'Edit',
    resetAction: 'Restore default',
    deleteAction: 'Delete',
  },
  roleForm: {
    nameLabel: 'Role name',
    descriptionPlaceholder: 'Description (optional)',
    descriptionLabel: 'Description',
    // The pt-BR pack inflects "selecionada/selecionadas" on the count; English
    // does not inflect here at all. Each locale owning its own rule is exactly
    // why these are functions — a shared template would force one of them to
    // carry a branch it does not need, or drop one the other does.
    selectionCount: (count) => `Permissions (${count} selected)`,
    kinds: { class: 'class', instance: 'instance' },
    cancelAction: 'Cancel',
    saveAction: 'Save',
    createAction: 'Create role',
  },
  teamScreen: {
    title: 'Team',
    searchPlaceholder: 'Search members',
    loadFailed: 'Could not load the team.',
    removeConfirm: {
      title: 'Remove from the team?',
      body: 'They lose access to the backoffice immediately.',
      confirmLabel: 'Remove',
    },
    cancelAction: 'Cancel',
    pendingInvitesTitle: 'Pending invitations',
    pendingInviteLine: (email, role) => `${email} — ${role} (Pending)`,
  },
  teamTable: {
    headers: { name: 'Name', email: 'E-mail', roles: 'Roles', status: 'Status' },
    status: { active: 'Active', disabled: 'Disabled' },
  },
  teamRoleDialog: {
    title: (member) => `Roles for ${member}`,
    fallbackTitle: 'Edit roles',
    systemGroupTitle: 'System role (pick one)',
    customGroupTitle: 'Custom roles (optional)',
    exactlyOneSystemRole: 'Select exactly one system role.',
    cancelAction: 'Cancel',
    saveAction: 'Save',
  },
  teamRowMenu: {
    editRoles: 'Edit roles',
    activate: 'Activate',
    deactivate: 'Deactivate',
    remove: 'Remove',
    noActions: 'No actions available',
  },
};
