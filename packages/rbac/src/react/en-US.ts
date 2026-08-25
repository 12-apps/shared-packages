import {
  EN_US_CONFIRM_ACTION_COPY,
  EN_US_DATA_VIEWS_COPY,
} from '@12-apps/ui/en-US';

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
  dataViews: EN_US_DATA_VIEWS_COPY,
  confirmAction: EN_US_CONFIRM_ACTION_COPY,
  menuLabel: 'Actions',
  actionErrorTitle: "Couldn't complete the action",
  closeLabel: 'Close',
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
    retryAction: 'Try again',
    aboutTitle: 'About roles',
    aboutBody:
      'The system roles ship ready to use — you can adjust each one\u2019s permissions for your store (except the owner). You can also compose custom roles from the permission catalog and assign them to your team.',
    emptyState: 'No roles found.',
    forbiddenTitle: 'Page not found',
    forbiddenBody: 'That address does not exist, or is not available.',
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
    kinds: { system: 'System', systemEdited: 'System \u00b7 edited', custom: 'Custom' },
    kindFilter: 'Kind',
    // What a wildcard role's permission count reads as, in place of a number.
    allPermissions: 'All',
    permissionsUnit: 'permissions',
    noDescription: 'no description',
    editableLabel: 'Editable',
    editableYes: 'Yes',
    lockedLabel: 'Locked',
    noPermissions: 'No permissions',
    emptyValue: '\u2014',
    editAction: 'Edit',
    resetAction: 'Restore default',
    deleteAction: 'Delete',
    historyAction: 'Version history',
    deleteFailed: 'Could not delete the role.',
    resetFailed: 'Could not restore the role to its default.',
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
    retryAction: 'Try again',
    aboutTitle: 'About the team',
    aboutBody:
      'Manage this store\u2019s administrators. You can invite by e-mail even somebody with no account yet — access is granted automatically when they sign up.',
    inviteAction: 'Add administrator',
    inviteDialogTitle: 'Add administrator',
    inviteEmailLabel: 'E-mail of the new administrator',
    inviteHint:
      'If they already have an account, access is granted right away. Otherwise the invitation stays pending and access is granted automatically when they sign up with that address.',
    inviteDeferredTitle: 'Invitation recorded',
    inviteDeferredBody: 'Access will be granted automatically when they create their account.',
    errorTitle: 'Could not update the team',
    emptyState: 'No administrators yet.',
    exportFileName: 'team',
    removeConfirm: {
      title: 'Remove from the team?',
      body: 'They lose access to the backoffice immediately. To return, they need a fresh invitation.',
      confirmLabel: 'Remove',
    },
    cancelInviteConfirm: {
      title: 'Cancel this invitation?',
      body: 'The link already sent stops working. To invite them again, send a new one.',
      confirmLabel: 'Cancel invitation',
      // The ACT is a cancellation, so the back-out cannot also read "Cancel".
      cancelLabel: 'Go back',
      failed: 'Could not cancel the invitation.',
    },
    removeFailed: 'Could not remove this person from the team.',
    cancelAction: 'Cancel',
  },
  teamTable: {
    headers: { name: 'Name', email: 'E-mail', roles: 'Roles', status: 'Status' },
    status: { active: 'Active', disabled: 'Disabled', pending: 'Pending' },
    filters: { roles: 'Roles', status: 'Status' },
    exportHeaders: {
      name: 'Name',
      email: 'E-mail',
      role: 'Role',
      customRoles: 'Custom roles',
      status: 'Status',
    },
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
    cancelInvite: 'Cancel invitation',
    noActions: 'No actions available',
  },
  memberProfile: {
    tabs: {
      details: 'User details',
      actions: 'User activity',
      ai: 'AI on the user\u2019s behalf',
      items: 'Items created',
    },
    comingSoon: 'This feature is coming soon.',
    fields: {
      baseRole: 'Base role',
      customRoles: 'Additional roles',
      memberSince: 'Member since',
      lastLogin: 'Last sign-in',
    },
    emptyValue: '\u2014',
    notFoundTitle: 'Member not found',
    notFoundBody: 'This user is not part of this store\u2019s team.',
    loadFailed: 'Could not load the profile.',
    retryAction: 'Try again',
    loading: 'Loading\u2026',
  },
};
